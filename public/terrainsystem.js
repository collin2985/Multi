// TerrainSystem.js - Modular terrain and water rendering system
// Extracted from terrain5.html for integration into external projects

import * as THREE from 'three';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const TERRAIN_CONFIG = {
    CLIPMAP_LEVELS: 6,
    CLIPMAP_SIZE: 129,          // 2^n + 1 for clean alignment (inner levels)
    CLIPMAP_SIZE_OUTER: 65,     // Reduced resolution for outer levels (0-2) - ~38% triangle savings
    TRANSITION_WIDTH: 0.45,     // 45% of level extent for smoother LOD blending

    TERRAIN_SCALE: 32,          // Finer base scale for more detail
    HEIGHT_SCALE: 40,
    TERRAIN_FREQUENCY: 0.01,    // Input coordinate scale for noise
    TERRAIN_OCTAVES: 6,         // Number of noise octaves (quality vs performance)

    WIREFRAME: false,
    SHOW_SEAMS: true,

    LOD_LERP_SPEED: 0.005,

    FOG_NEAR: 300,
    FOG_FAR: 500,

    // Distance fade (terrain fades to transparent before clipmap edge)
    TERRAIN_FADE_START: 450,
    TERRAIN_FADE_END: 500,

    // Texture coordinate wrapping period (must be power of 2, large enough to hide seams)
    // Wrapping happens on CPU with 64-bit precision to avoid GPU float32 precision loss
    TILE_PERIOD: 1024.0,

    // Water chunk system
    WATER_CHUNK_SIZE: 100,
    WATER_CHUNKS_RADIUS: 4,
    WATER_SEGMENTS: 32,

    // Gerstner waves (reduced to max ~0.5 units total displacement)
    WAVE_A: { direction: 0, steepness: 0.032, wavelength: 60 },
    WAVE_B: { direction: 30, steepness: 0.024, wavelength: 35 },
    WAVE_C: { direction: 60, steepness: 0.02, wavelength: 20 },
    WAVE_D: { direction: 90, steepness: 0.016, wavelength: 12 },

    // Wave damping near shore
    WAVE_DAMPING_MIN_DEPTH: 0.5,  // Waves fully suppressed from depth 0 to this depth
    WAVE_DAMPING_MAX_DEPTH: 3.0,  // Waves reach full strength at this depth (reduced for smoother transition)

    // Foam
    FOAM_MAX_DEPTH: 5.0,
    FOAM_WAVE_INFLUENCE: 1.0,  // Whitecap strength (0-1)
    FOAM_TEXTURE_SCALE: 0.13,
    FOAM_TEXTURE_SPEED: 0.8,    // Slowed down from 2.0
    FOAM_TEXTURE_INTENSITY: 1.5,
    FOAM_TEXTURE_ROTATION: 19,      // Degrees - breaks up tiling patterns
    FOAM_TEXTURE_DEPTH_LIMIT: 4.0,  // Depth beyond which foam texture fades (was 5.0)

    // Water effect toggles (quality-gated, 1.0 = on, 0.0 = off)
    WATER_ENABLE_SSS: 1.0,           // Subsurface scattering glow on wave crests
    WATER_ENABLE_DETAIL_NORMALS: 1.0, // Surface ripple details
    WATER_ENABLE_CREST_COLOR: 1.0,   // Wave crest color variation
    WATER_ENABLE_GLITTER: 1.0,       // Shimmer sparkles (most expensive)
    WATER_ENABLE_DEEP_COLOR: 1.0,    // Deep water color variation
    WATER_ENABLE_FOAM: 1.0,          // Foam system (3-4 texture samples)
    WATER_ENABLE_ENV_MAP: 1.0,       // Cubemap reflections
    WATER_WAVE_COUNT: 4,             // Gerstner waves (4=high, 2=low)
    WATER_TRANSPARENT: 1.0,          // Water transparency (1=transparent, 0=opaque for less overdraw)

    // Terrain effect toggles (quality-gated)
    TERRAIN_ENABLE_NORMAL_PERTURB: 1.0, // Surface normal perturbation (4 noise calls)
    TERRAIN_ENABLE_PROCEDURAL_BLEND: 1.0, // Procedural textures in blend zone (0=PNG only, saves ~50% GPU)
    TERRAIN_PROCEDURAL_OCTAVES: 3,      // Noise octaves for procedural (3=high, 2=med, 1=low)
    TERRAIN_ENABLE_TRIPLANAR: 1.0,      // Triplanar mapping (0=Y projection only, saves 2 samples/call)

    // Depth texture update frequency (higher = less frequent updates)
    DEPTH_SNAP_MULTIPLIER: 4,

    // Billboard system capacity (quality-gated to reduce GPU memory)
    BILLBOARD_MAX_INSTANCES: 100000,

    // Depth texture
    DEPTH_TEXTURE_SIZE: 1024,
    DEPTH_RANGE: 1000,
    DEPTH_HEIGHT_MIN: -30,
    DEPTH_HEIGHT_MAX: 45,  // Changed from 85 to match HEIGHT_SCALE of 40

    // Continent system
    CONTINENT_SPACING: 2000,        // Distance between continent grid points
    CONTINENT_RADIUS: 500,          // Base radius of continents
    CONTINENT_RADIUS_NOISE: 0.3,    // How much noise affects radius (0-1)
    TRANSITION_ZONE: 150,           // Width of underwater transition zone
    OCEAN_MIN_DEPTH: -30,           // Minimum depth (ocean floor depth)
};

// Helper for wrapping coordinates on CPU with 64-bit precision (handles negatives correctly)
export function wrapCoord(v) {
    const p = TERRAIN_CONFIG.TILE_PERIOD;
    return ((v % p) + p) % p;
}

// ============================================================================
// SHARED SHADER CODE
// ============================================================================

const SHADER_COMMON_UNIFORMS = `
    uniform float heightScale;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 fogColor;
    uniform vec3 sunDirection;
    uniform vec3 sandDark;
    uniform vec3 sandLight;
    uniform vec3 grassDark;
    uniform vec3 grassLight;
    uniform vec3 rockDark;
    uniform vec3 rockLight;
    uniform vec3 snowDark;
    uniform vec3 snowLight;

    // Distance fade uniforms
    uniform float fadeStart;
    uniform float fadeEnd;

    // Quality control uniforms
    uniform float enableNormalPerturb;
    uniform float enableProceduralBlend;  // Skip procedural textures on LOW (use PNG only)
    uniform float proceduralOctaves;      // Reduce noise octaves on LOW (3=high, 2=med, 1=low)
    uniform float enableTriplanar;        // Skip triplanar on LOW (use Y projection only)

    // LOD texture samplers
    uniform float texturesLoaded;   // 0 = textures not loaded (use procedural), 1 = loaded (use PNG)
    uniform sampler2D texGrass;
    uniform sampler2D texGrass2;
    uniform sampler2D texRock;
    uniform sampler2D texSand;
    uniform sampler2D texSand2;
    uniform sampler2D texDirt;
    uniform sampler2D texSnow;
    uniform float textureLodNear;   // Distance where PNG textures are 100%
    uniform float textureLodFar;    // Distance where procedural is 100%
    uniform float textureRepeat;    // How often textures tile per world unit

    // Dirt overlay uniforms (for structure/tree dirt patches)
    uniform sampler2D texDirtOverlay;
    uniform vec2 dirtOverlayCenter;
    uniform float dirtOverlayRange;

    // Road textures (for road painting)
    uniform sampler2D texRoad;        // Limestone roads (gray)
    uniform sampler2D texYellowRoad;  // Sandstone roads (yellow)
`;

const SHADER_NOISE = `
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float noise3D(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = mix(
            mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        return n;
    }

    float fbm(vec2 p, int octaves) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * noise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        return value;
    }

    float fbm3D(vec3 p, int octaves) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * noise3D(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        return value;
    }
`;

const SHADER_TEXTURES = `
    vec3 grassTexture(vec2 p, float scale, int octaves) {
        vec3 p3 = vec3(p.x, 0.0, p.y);
        float n1 = fbm3D(p3 * scale, octaves);
        float n2 = fbm3D(p3 * scale * 3.7 + 100.0, max(octaves - 1, 1));
        float n3 = octaves >= 4 ? noise3D(p3 * scale * 15.0) : 0.5;
        vec3 grassYellowColor = vec3(0.541, 0.059, 0.059);
        vec3 color = mix(grassDark, grassLight, n1);
        color = mix(color, grassYellowColor, n2 * 0.3);
        color *= 0.85 + n3 * 0.3;
        return color;
    }

    vec3 rockTexture(vec2 p, float scale, int octaves) {
        vec3 p3 = vec3(p.x, 0.0, p.y);
        float n1 = fbm3D(p3 * scale, octaves);
        float n2 = fbm3D(p3 * scale * 2.3 + 50.0, max(octaves - 1, 1));
        float crack = octaves >= 4 ? smoothstep(0.4, 0.5, fbm3D(p3 * scale * 8.0, 3)) : 0.0;
        float layer = sin(p.y * scale * 2.0 + n1 * 3.0) * 0.5 + 0.5;
        vec3 rockWarm = mix(rockDark, rockLight, 0.6);
        vec3 color = mix(rockDark, rockLight, n1);
        color = mix(color, rockWarm, layer * 0.3);
        color = mix(color, rockDark * 0.7, crack * 0.5);
        color *= 0.8 + n2 * 0.4;
        return color;
    }

    vec3 sandTexture(vec2 p, float scale, int octaves) {
        vec3 p3 = vec3(p.x, 0.0, p.y);
        float n1 = fbm3D(p3 * scale, octaves);
        float n2 = octaves >= 4 ? noise3D(p3 * scale * 20.0) : 0.5;
        float ripple = sin(p.x * scale * 0.5 + n1 * 5.0) * 0.5 + 0.5;
        vec3 dirt = vec3(0.45, 0.35, 0.25);
        vec3 color = mix(sandDark, sandLight, n1);
        color = mix(color, dirt, smoothstep(0.4, 0.6, n1) * 0.4);
        color *= 0.9 + n2 * 0.2;
        color = mix(color, sandLight, ripple * 0.15);
        return color;
    }

    vec3 snowTexture(vec2 p, float scale, int octaves) {
        vec3 p3 = vec3(p.x, 0.0, p.y);
        float n1 = fbm3D(p3 * scale, max(octaves - 1, 1));
        float n2 = octaves >= 4 ? noise3D(p3 * scale * 30.0) : 0.5;
        float drift = fbm3D(p3 * scale * 0.5, max(octaves - 2, 1));
        vec3 snowShadow = snowDark * 0.88;
        vec3 color = mix(snowDark, snowLight, n1);
        color = mix(color, snowShadow, drift * 0.2);
        float sparkle = smoothstep(0.85, 0.95, n2);
        color += sparkle * 0.15;
        return color;
    }

    vec3 triplanarTexture(vec3 pos, vec3 normal, float scale, int texType, int octaves, float distToCamera) {
        // Use fixed blend power - no distance-based variation to prevent texture swimming
        float blendPower = 3.0;

        vec3 blend = abs(normal);
        blend = blend / (blend.x + blend.y + blend.z + 0.001);
        blend = pow(blend, vec3(blendPower));
        blend = blend / (blend.x + blend.y + blend.z + 0.001);

        // Fast path: mostly flat terrain (Y projection dominates)
        // Saves 2 biome texture calls (each with fbm3D noise) when blend.y > 0.90
        // Increased threshold from 0.98 to 0.90 for better GPU performance
        if (blend.y > 0.90) {
            if (texType == 0) return grassTexture(pos.xz, scale, octaves);
            else if (texType == 1) return rockTexture(pos.xz, scale, octaves);
            else if (texType == 2) return sandTexture(pos.xz, scale, octaves);
            else return snowTexture(pos.xz, scale, octaves);
        }

        // Full triplanar for slopes
        vec3 xProj, yProj, zProj;
        if (texType == 0) {
            xProj = grassTexture(pos.zy, scale, octaves);
            yProj = grassTexture(pos.xz, scale, octaves);
            zProj = grassTexture(pos.xy, scale, octaves);
        } else if (texType == 1) {
            xProj = rockTexture(pos.zy, scale, octaves);
            yProj = rockTexture(pos.xz, scale, octaves);
            zProj = rockTexture(pos.xy, scale, octaves);
        } else if (texType == 2) {
            xProj = sandTexture(pos.zy, scale, octaves);
            yProj = sandTexture(pos.xz, scale, octaves);
            zProj = sandTexture(pos.xy, scale, octaves);
        } else {
            xProj = snowTexture(pos.zy, scale, octaves);
            yProj = snowTexture(pos.xz, scale, octaves);
            zProj = snowTexture(pos.xy, scale, octaves);
        }
        return xProj * blend.x + yProj * blend.y + zProj * blend.z;
    }
`;

// PNG triplanar sampling - samples texture from 3 directions and blends based on normal
const SHADER_PNG_TRIPLANAR = `
    vec3 triplanarPNG(sampler2D tex, vec3 pos, vec3 normal, float repeat) {
        // LOW QUALITY: Skip triplanar entirely - use Y projection only
        // Saves 2 texture samples per call (major GPU savings)
        if (enableTriplanar < 0.5) {
            return texture2D(tex, pos.xz * repeat).rgb;
        }

        // Triplanar blend weights
        vec3 blend = abs(normal);
        blend = pow(blend, vec3(4.0));  // Sharper blending
        blend = blend / (blend.x + blend.y + blend.z + 0.001);

        // Fast path: mostly flat terrain (Y projection dominates)
        // Saves 2 texture samples when blend.y > 0.90 (~25 degree slope threshold)
        if (blend.y > 0.90) {
            return texture2D(tex, pos.xz * repeat).rgb;
        }

        // Full triplanar for slopes
        vec3 xProj = texture2D(tex, pos.zy * repeat).rgb;
        vec3 yProj = texture2D(tex, pos.xz * repeat).rgb;
        vec3 zProj = texture2D(tex, pos.xy * repeat).rgb;

        return xProj * blend.x + yProj * blend.y + zProj * blend.z;
    }

    // Get PNG-based terrain color (near camera)
    vec3 getPngTerrainColor(vec3 stablePos, vec3 normal, float height, float slope, float repeat) {
        float h = height / heightScale;

        // Biome weights (same logic as procedural)
        // Sand: full up to height 2, fades out from 2 to 4 (grass starts at 2)
        float sandWeight = smoothstep(4.0 / heightScale, 2.0 / heightScale, h);
        float snowWeight = smoothstep(0.55, 0.95, h);
        float rockWeight = smoothstep(0.0, 0.25, slope);
        float grassWeight = 1.0 - sandWeight - snowWeight;
        grassWeight *= smoothstep(0.55, 0.35, h);
        grassWeight = max(0.0, grassWeight - rockWeight * 0.7);

        // Normalize weights
        float totalWeight = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
        sandWeight /= totalWeight;
        grassWeight /= totalWeight;
        rockWeight /= totalWeight;
        snowWeight /= totalWeight;

        // Add noise variation for natural transitions
        float blendNoise = fbm(stablePos.xz * 0.1, 3) * 0.3;
        sandWeight = clamp(sandWeight + blendNoise * (1.0 - h), 0.0, 1.0);
        snowWeight = clamp(snowWeight + blendNoise * h, 0.0, 1.0);

        // Re-normalize
        totalWeight = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
        sandWeight /= totalWeight;
        grassWeight /= totalWeight;
        rockWeight /= totalWeight;
        snowWeight /= totalWeight;

        // Only sample textures with meaningful weight (> 0.01)
        // This skips 4-5 textures per pixel depending on biome
        vec3 result = vec3(0.0);

        if (grassWeight > 0.01) {
            // Grass: blend grass and grass2 with dirt patches
            vec3 grass1 = triplanarPNG(texGrass, stablePos, normal, repeat);
            vec3 grass2 = triplanarPNG(texGrass2, stablePos, normal, repeat);
            vec3 dirt = triplanarPNG(texDirt, stablePos, normal, repeat);
            float grassMix = fbm(stablePos.xz * 0.05, 2);
            float dirtMix = smoothstep(0.55, 0.7, fbm(stablePos.xz * 0.15 + 50.0, 2)) * 0.4;
            result += mix(mix(grass1, grass2, grassMix), dirt, dirtMix) * grassWeight;
        }

        if (sandWeight > 0.01) {
            // Sand: wet sand fades out from 0 to 1, dry sand fades in from 0 to 3
            vec3 sandDry = triplanarPNG(texSand, stablePos, normal, repeat);
            vec3 sandWet = triplanarPNG(texSand2, stablePos, normal, repeat);
            float wetness = smoothstep(1.0, 0.0, height) * (1.0 - slope);
            result += mix(sandDry, sandWet, wetness) * sandWeight;
        }

        if (rockWeight > 0.01) {
            result += triplanarPNG(texRock, stablePos, normal, repeat) * rockWeight;
        }

        if (snowWeight > 0.01) {
            result += triplanarPNG(texSnow, stablePos, normal, repeat) * snowWeight;
        }

        return result;
    }
`;

const SHADER_TERRAIN_COLOR = `
    vec3 getTerrainTexture(vec3 stablePos, vec3 normal, float height, float slope, float distToCamera, float texScale, int texOctaves) {
        // ULTRA-FAR LOD: Skip all texture sampling beyond 250 units
        // Uses simple biome color lookup - saves ~60% texture lookups for distant terrain
        if (distToCamera > 250.0) {
            float h = height / heightScale;
            float sandWeight = smoothstep(0.12, 0.0, h);
            float snowWeight = smoothstep(0.55, 0.95, h);
            float rockWeight = smoothstep(0.0, 0.2, slope);
            float grassWeight = 1.0 - sandWeight - snowWeight;
            grassWeight *= smoothstep(0.55, 0.35, h);
            grassWeight = max(0.0, grassWeight - rockWeight);

            // Normalize weights
            float totalWeight = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
            sandWeight /= totalWeight;
            grassWeight /= totalWeight;
            rockWeight /= totalWeight;
            snowWeight /= totalWeight;

            // Simple averaged biome colors (no textures, no noise)
            vec3 sandColor = mix(sandDark, sandLight, 0.5);
            vec3 grassColor = mix(grassDark, grassLight, 0.5);
            vec3 rockColor = mix(rockDark, rockLight, 0.5);
            vec3 snowColor = mix(snowDark, snowLight, 0.5);

            return sandColor * sandWeight + grassColor * grassWeight + rockColor * rockWeight + snowColor * snowWeight;
        }

        // LOW QUALITY: Skip procedural entirely - use PNG textures at all distances
        // This saves ~50% GPU by avoiding all procedural noise calculations
        // Only use PNG path if textures are loaded (texturesLoaded > 0.5)
        if (enableProceduralBlend < 0.5 && texturesLoaded > 0.5) {
            vec3 baseColor = getPngTerrainColor(stablePos, normal, height, slope, textureRepeat);

            // Dirt overlay (must be included for roads/structure patches)
            float tilePeriod = 1024.0;
            vec2 wrappedTexCoord = mod(vTexCoord, tilePeriod);
            vec2 dirtDiff = wrappedTexCoord - dirtOverlayCenter;
            if (dirtDiff.x > tilePeriod * 0.5) dirtDiff.x -= tilePeriod;
            if (dirtDiff.x < -tilePeriod * 0.5) dirtDiff.x += tilePeriod;
            if (dirtDiff.y > tilePeriod * 0.5) dirtDiff.y -= tilePeriod;
            if (dirtDiff.y < -tilePeriod * 0.5) dirtDiff.y += tilePeriod;
            vec2 dirtUV = dirtDiff / dirtOverlayRange + 0.5;

            if (dirtUV.x >= 0.0 && dirtUV.x <= 1.0 && dirtUV.y >= 0.0 && dirtUV.y <= 1.0) {
                vec3 overlayWeights = texture2D(texDirtOverlay, dirtUV).rgb;
                if (overlayWeights.r > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texDirt, stablePos, normal, textureRepeat * 1.5), overlayWeights.r);
                }
                if (overlayWeights.g > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texRoad, stablePos, normal, textureRepeat * 4.0), overlayWeights.g);
                }
                if (overlayWeights.b > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texYellowRoad, stablePos, normal, textureRepeat * 4.0), overlayWeights.b);
                }
            }

            return baseColor;
        }

        // Calculate LOD blend factor: 0 = PNG textures, 1 = procedural
        float lodBlend = smoothstep(textureLodNear, textureLodFar, distToCamera);

        // Early-out for near camera - skip ALL procedural computation
        // Saves ~72 noise evaluations (4 biomes × 3 triplanar × ~6 octaves)
        // Only use PNG path if textures are loaded (texturesLoaded > 0.5)
        if (lodBlend <= 0.01 && texturesLoaded > 0.5) {
            vec3 baseColor = getPngTerrainColor(stablePos, normal, height, slope, textureRepeat);

            // Dirt overlay (must be included for roads/structure patches)
            float tilePeriod = 1024.0;
            vec2 wrappedTexCoord = mod(vTexCoord, tilePeriod);
            vec2 dirtDiff = wrappedTexCoord - dirtOverlayCenter;
            if (dirtDiff.x > tilePeriod * 0.5) dirtDiff.x -= tilePeriod;
            if (dirtDiff.x < -tilePeriod * 0.5) dirtDiff.x += tilePeriod;
            if (dirtDiff.y > tilePeriod * 0.5) dirtDiff.y -= tilePeriod;
            if (dirtDiff.y < -tilePeriod * 0.5) dirtDiff.y += tilePeriod;
            vec2 dirtUV = dirtDiff / dirtOverlayRange + 0.5;

            if (dirtUV.x >= 0.0 && dirtUV.x <= 1.0 && dirtUV.y >= 0.0 && dirtUV.y <= 1.0) {
                vec3 overlayWeights = texture2D(texDirtOverlay, dirtUV).rgb;
                if (overlayWeights.r > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texDirt, stablePos, normal, textureRepeat * 1.5), overlayWeights.r);
                }
                if (overlayWeights.g > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texRoad, stablePos, normal, textureRepeat * 4.0), overlayWeights.g);
                }
                if (overlayWeights.b > 0.01) {
                    baseColor = mix(baseColor, triplanarPNG(texYellowRoad, stablePos, normal, textureRepeat * 4.0), overlayWeights.b);
                }
            }

            return baseColor;
        }

        // Calculate procedural (only for mid/far distances)
        // Use quality-controlled octaves (HIGH=3, MEDIUM=2, LOW=1)
        int octaves = int(proceduralOctaves);
        float scale = texScale;

        float h = height / heightScale;
        float sandWeight = smoothstep(0.12, 0.0, h);
        float snowWeight = smoothstep(0.55, 0.95, h);
        float rockWeight = smoothstep(0.0, 0.2, slope);
        float grassWeight = 1.0 - sandWeight - snowWeight;
        grassWeight *= smoothstep(0.55, 0.35, h);
        grassWeight = max(0.0, grassWeight - rockWeight);
        float totalWeight = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
        sandWeight /= totalWeight;
        grassWeight /= totalWeight;
        rockWeight /= totalWeight;
        snowWeight /= totalWeight;

        // Reduce blend noise octaves at distance (imperceptible difference beyond 100 units)
        int blendOctaves = distToCamera < 100.0 ? 3 : (distToCamera < 180.0 ? 2 : 1);
        float blendNoise = fbm(stablePos.xz * 0.1, blendOctaves) * 0.3;
        sandWeight = clamp(sandWeight + blendNoise * (1.0 - h), 0.0, 1.0);
        snowWeight = clamp(snowWeight + blendNoise * h, 0.0, 1.0);
        totalWeight = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
        sandWeight /= totalWeight;
        grassWeight /= totalWeight;
        rockWeight /= totalWeight;
        snowWeight /= totalWeight;

        // Only compute biomes with meaningful weight (>1%) - saves ~75% when in single biome
        vec3 proceduralColor = vec3(0.0);
        if (sandWeight > 0.01) {
            proceduralColor += triplanarTexture(stablePos, normal, scale, 2, octaves, distToCamera) * sandWeight;
        }
        if (grassWeight > 0.01) {
            proceduralColor += triplanarTexture(stablePos, normal, scale, 0, octaves, distToCamera) * grassWeight;
        }
        if (rockWeight > 0.01) {
            proceduralColor += triplanarTexture(stablePos, normal, scale, 1, octaves, distToCamera) * rockWeight;
        }
        if (snowWeight > 0.01) {
            proceduralColor += triplanarTexture(stablePos, normal, scale, 3, octaves, distToCamera) * snowWeight;
        }

        // Early out if fully procedural (far from camera) OR textures not loaded
        if (lodBlend >= 0.99 || texturesLoaded < 0.5) {
            return proceduralColor;
        }

        // Blend zone - both PNG and procedural needed
        vec3 pngColor = getPngTerrainColor(stablePos, normal, height, slope, textureRepeat);
        vec3 baseColor = mix(pngColor, proceduralColor, lodBlend);

        // Sample dirt overlay for structure/tree dirt patches
        float tilePeriod = 1024.0;
        vec2 wrappedTexCoord = mod(vTexCoord, tilePeriod);
        vec2 dirtDiff = wrappedTexCoord - dirtOverlayCenter;
        if (dirtDiff.x > tilePeriod * 0.5) dirtDiff.x -= tilePeriod;
        if (dirtDiff.x < -tilePeriod * 0.5) dirtDiff.x += tilePeriod;
        if (dirtDiff.y > tilePeriod * 0.5) dirtDiff.y -= tilePeriod;
        if (dirtDiff.y < -tilePeriod * 0.5) dirtDiff.y += tilePeriod;
        vec2 dirtUV = dirtDiff / dirtOverlayRange + 0.5;

        if (dirtUV.x >= 0.0 && dirtUV.x <= 1.0 && dirtUV.y >= 0.0 && dirtUV.y <= 1.0) {
            vec3 overlayWeights = texture2D(texDirtOverlay, dirtUV).rgb;
            float dirtWeight = overlayWeights.r;
            float roadWeight = overlayWeights.g;
            float yellowRoadWeight = overlayWeights.b;

            if (dirtWeight > 0.01) {
                vec3 dirtColor = triplanarPNG(texDirt, stablePos, normal, textureRepeat * 1.5);
                baseColor = mix(baseColor, dirtColor, dirtWeight);
            }
            if (roadWeight > 0.01) {
                vec3 roadColor = triplanarPNG(texRoad, stablePos, normal, textureRepeat * 4.0);
                baseColor = mix(baseColor, roadColor, roadWeight);
            }
            if (yellowRoadWeight > 0.01) {
                vec3 yellowRoadColor = triplanarPNG(texYellowRoad, stablePos, normal, textureRepeat * 4.0);
                baseColor = mix(baseColor, yellowRoadColor, yellowRoadWeight);
            }
        }

        return baseColor;
    }
`;

const SHADER_NORMAL_PERTURBATION = `
    vec3 perturbNormal(vec3 normal, vec3 stablePos, float distToCamera) {
        // Skip perturbation entirely on LOW quality - saves 4 noise calls per pixel
        if (enableNormalPerturb < 0.5) {
            return normal;
        }
        // Skip perturbation for distant terrain
        // Normal detail is imperceptible beyond 100 units
        if (distToCamera > 100.0) {
            return normal;
        }

        // stablePos is already wrapped, safe to use directly
        vec2 posXZ = stablePos.xz;

        float perturbScale = 0.15;
        vec3 perturbation = vec3(
            noise(posXZ * 2.0) - 0.5,
            0.0,
            noise(posXZ * 2.0 + 100.0) - 0.5
        ) * perturbScale;

        // Fixed detail level - no distance-based fading to prevent swimming
        perturbation += vec3(
            noise(posXZ * 8.0 + 50.0) - 0.5,
            0.0,
            noise(posXZ * 8.0 + 150.0) - 0.5
        ) * perturbScale * 0.5;

        return normalize(normal + perturbation);
    }
`;

const SHADER_LIGHTING = `
    vec3 computeLighting(vec3 terrainColor, vec3 normal, float height, float NdotL, float extraAO) {
        float ao = 1.0;
        float heightGrad = length(vec2(dFdx(height), dFdy(height)));
        ao = 1.0 - smoothstep(0.0, 5.0, heightGrad) * 0.4;
        ao *= extraAO;

        vec3 skyColor = vec3(0.4, 0.5, 0.7);
        vec3 groundColor = vec3(0.3, 0.25, 0.2);
        float skyBlend = normal.y * 0.5 + 0.5;
        vec3 ambient = mix(groundColor, skyColor, skyBlend) * 0.35;
        vec3 directLight = vec3(1.0, 0.95, 0.85) * NdotL * 0.8;
        vec3 finalLight = (ambient + directLight) * ao;

        return terrainColor * finalLight;
    }
`;

const SHADER_FOG = `
    vec3 applyFog(vec3 color, float fogDepth) {
        float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
        return mix(color, fogColor, fogFactor);
    }
`;

// ============================================================================
// WATER SHADERS
// ============================================================================

const WATER_VERTEX_SHADER = `
    #define PI 3.14159265359

    uniform float time;
    uniform vec4 waveA;  // (dirX, dirZ, steepness, wavelength)
    uniform vec4 waveB;
    uniform vec4 waveC;
    uniform vec4 waveD;
    uniform float waveCount;  // Number of waves to compute (4=high, 2=low)

    // Depth texture uniforms for wave damping near shore
    uniform sampler2D depthTexture;
    uniform vec2 depthCenter;
    uniform float depthRange;
    uniform float depthHeightMin;
    uniform float depthHeightMax;
    uniform float waveDampingMinDepth;  // Depth below which waves are fully suppressed (default 1)
    uniform float waveDampingMaxDepth;  // Depth at which waves reach full strength (default 5)

    varying vec3 vWorldPos;
    varying vec3 vOriginalWorldPos;  // Pre-wave position for depth sampling
    varying vec3 vNormal;
    varying float vWaveSlope;
    varying float vWaveHeight;
    varying float vFogDepth;

    // Get terrain height from depth texture (for wave damping)
    // Uses soft edge fade to prevent flickering at depth texture boundaries
    float getTerrainHeightVS(vec2 pos) {
        vec2 offset = pos - depthCenter;
        vec2 absOffset = abs(offset);
        float edgeDist = max(absOffset.x, absOffset.y);
        float edgeMax = depthRange * 0.5;

        if (edgeDist > edgeMax * 0.95) {
            return -100.0;
        }

        vec2 uv = vec2(offset.x, -offset.y) / depthRange + 0.5;
        uv = clamp(uv, 0.002, 0.998);

        float normalized = textureLod(depthTexture, uv, 0.0).r;
        float height = mix(depthHeightMin, depthHeightMax, normalized);

        float edgeFade = 1.0 - smoothstep(edgeMax * 0.8, edgeMax * 0.95, edgeDist);
        return mix(-100.0, height, edgeFade);
    }

    vec3 GerstnerWave(vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * PI / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xz) - c * time * 0.5);
        float a = steepness / k;

        tangent += vec3(
            -d.x * d.x * steepness * sin(f),
            d.x * steepness * cos(f),
            -d.x * d.y * steepness * sin(f)
        );
        binormal += vec3(
            -d.x * d.y * steepness * sin(f),
            d.y * steepness * cos(f),
            -d.y * d.y * steepness * sin(f)
        );

        return vec3(
            d.x * (a * cos(f)),
            a * sin(f),
            d.y * (a * cos(f))
        );
    }

    void main() {
        vec3 pos = position;

        // Use world position for wave calculations so waves align across chunks
        vec3 worldPosForWaves = (modelMatrix * vec4(pos, 1.0)).xyz;

        // Store original world position BEFORE wave displacement for depth sampling
        vOriginalWorldPos = worldPosForWaves;

        // Calculate depth for wave damping (terrain height is negative underwater)
        float terrainHeight = getTerrainHeightVS(worldPosForWaves.xz);
        float depth = -terrainHeight;  // Convert to positive depth

        // Waves fully suppressed from 0 to minDepth, then ramp up to full at maxDepth
        float waveDamping = clamp((depth - waveDampingMinDepth) / (waveDampingMaxDepth - waveDampingMinDepth), 0.0, 1.0);

        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);

        // Apply Gerstner waves with depth-based damping
        // On LOW quality, only compute 2 waves instead of 4 (saves 2 sin/cos/normalize per vertex)
        vec3 waveDisplacement = vec3(0.0);
        waveDisplacement += GerstnerWave(waveA, worldPosForWaves, tangent, binormal);
        waveDisplacement += GerstnerWave(waveB, worldPosForWaves, tangent, binormal);
        if (waveCount > 2.5) {
            waveDisplacement += GerstnerWave(waveC, worldPosForWaves, tangent, binormal);
            waveDisplacement += GerstnerWave(waveD, worldPosForWaves, tangent, binormal);
        }

        // Apply damping to wave displacement
        // Extra clamp: completely zero out waves when depth < 0.3 to prevent any intersection
        float shallowClamp = smoothstep(0.0, 0.3, depth);
        pos += waveDisplacement * waveDamping * shallowClamp;

        // Calculate wave normal from tangent and binormal (also damped)
        vec3 dampedTangent = mix(vec3(1.0, 0.0, 0.0), tangent, waveDamping);
        vec3 dampedBinormal = mix(vec3(0.0, 0.0, 1.0), binormal, waveDamping);
        vNormal = normalize(cross(dampedBinormal, dampedTangent));

        // Wave slope for foam (length of horizontal normal component)
        vWaveSlope = length(vec2(vNormal.x, vNormal.z));

        // Wave height displacement for foam (damped)
        vWaveHeight = (pos.y - position.y);

        // Only clamp water Y when terrain is underwater (negative height)
        // This prevents wave troughs from going below the seabed in shallow water
        // Do NOT clamp when terrain is above water - that would push water UP slopes!
        if (terrainHeight < 0.0 && terrainHeight > -10.0) {
            float minWaterY = terrainHeight + 0.05;  // 5cm above seabed
            if (pos.y < minWaterY) {
                pos.y = minWaterY;
            }
        }

        // Output world position (after wave displacement and clamping)
        vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos4.xyz;

        vec4 viewPos = viewMatrix * worldPos4;
        vFogDepth = length(viewPos.xyz);  // Euclidean distance for uniform fog
        gl_Position = projectionMatrix * viewPos;
    }
`;

const WATER_FRAGMENT_SHADER = `
    uniform sampler2D depthTexture;
    uniform vec2 depthCenter;
    uniform float depthRange;
    uniform float depthHeightMin;
    uniform float depthHeightMax;

    uniform vec3 waterColor;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform float fadeStart;
    uniform float fadeEnd;
    uniform vec3 sunDirection;
    uniform float time;

    // Environment map for reflections
    uniform samplerCube envMap;

    // Foam uniforms
    uniform sampler2D foamTexture;
    uniform float foamMaxDepth;
    uniform float foamWaveInfluence;
    uniform float foamTextureScale;
    uniform float foamTextureSpeed;
    uniform float foamTextureIntensity;
    uniform float foamTextureRotation;
    uniform float foamTextureDepthLimit;
    uniform float foamTime;
    uniform float whitecapThreshold;

    // Effect toggles (0.0 = off, 1.0 = on)
    uniform float enableSSS;
    uniform float enableDetailNormals;
    uniform float enableCrestColor;
    uniform float enableGlitter;
    uniform float enableDeepColor;
    uniform float enableFoam;
    uniform float enableEnvMap;

    // SSS parameters
    uniform float sssStrength;
    uniform vec3 sssColor;

    // Detail normal parameters
    uniform float detailNormalStrength;
    uniform float detailNormalScale1;
    uniform float detailNormalScale2;
    uniform float detailNormalFadeStart;
    uniform float detailNormalFadeEnd;

    // Crest color parameters
    uniform float crestColorStrength;
    uniform vec3 crestColor;

    // Shimmer parameters (noise-based, sun-independent)
    uniform float shimmerStrength;
    uniform float shimmerScale;
    uniform float shimmerSpeed;

    // Deep water color
    uniform vec3 deepWaterColor;
    uniform float deepColorDepth;

    // Opaque mode (LOW quality) - use discard instead of alpha fade
    uniform float isOpaque;

    varying vec3 vWorldPos;
    varying vec3 vOriginalWorldPos;  // Pre-wave position for depth sampling
    varying vec3 vNormal;
    varying float vWaveSlope;
    varying float vWaveHeight;
    varying float vFogDepth;

    // Get terrain height and continent mask from depth texture
    // Returns vec2(height, continentMask)
    // Uses soft edge fade to prevent flickering at depth texture boundaries
    vec2 getTerrainData(vec2 pos) {
        vec2 offset = pos - depthCenter;

        // Soft edge fade instead of hard cutoff
        vec2 absOffset = abs(offset);
        float edgeDist = max(absOffset.x, absOffset.y);
        float edgeMax = depthRange * 0.5;
        float edgeFade = 1.0 - smoothstep(edgeMax * 0.8, edgeMax * 0.98, edgeDist);

        if (edgeFade < 0.01) {
            return vec2(-100.0, 0.0);
        }

        vec2 uv = vec2(offset.x, -offset.y) / depthRange + 0.5;
        uv = clamp(uv, 0.002, 0.998);

        vec4 texData = texture2D(depthTexture, uv);
        float height = mix(depthHeightMin, depthHeightMax, texData.r);
        height = mix(-50.0, height, edgeFade);

        float continentMask = texData.g * edgeFade;
        return vec2(height, continentMask);
    }

    // Cheap noise for foam variation
    float cheapNoise(vec2 uv) {
        return texture2D(foamTexture, uv * 0.1).r;
    }

    void main() {
        // Get terrain data at ORIGINAL position (before wave displacement)
        // This ensures water/shore boundary aligns correctly regardless of wave motion
        vec2 terrainData = getTerrainData(vOriginalWorldPos.xz);
        float terrainHeight = terrainData.x;
        float continentMask = terrainData.y;

        // Smooth shore transition - widened range for better blending
        // Start fading earlier (at height -0.5) and complete by height 0.3
        // This creates a larger "safe zone" where water is clearly below terrain
        float shoreBlend = smoothstep(-0.5, 0.3, terrainHeight);
        if (shoreBlend > 0.995) {
            discard;
        }

        // Calculate water depth (how far below water surface the terrain is)
        float depth = -terrainHeight;  // terrainHeight is negative underwater

        // Distance-based LOD for shader effects (reduces texture samples at range)
        float dist = length(vWorldPos - cameraPosition);
        float distClose = 300.0;
        float distMedium = 300.0;  // Same as close - skip medium tier, go straight to far
        bool isClose = dist < distClose;
        bool isMedium = dist < distMedium;

        // Base water color with depth-based transparency
        float depthFactor = clamp(depth / 15.0, 0.0, 1.0);
        float alpha = mix(0.4, 1.0, depthFactor);

        // Base water color with depth-based deep color variation
        vec3 baseWaterColor = waterColor;
        if (enableDeepColor > 0.5) {
            float depthColorFactor = 1.0 - exp(-depth / deepColorDepth);
            baseWaterColor = mix(waterColor, deepWaterColor, depthColorFactor);
        }
        vec3 color = baseWaterColor;

        // Wave crests are lighter/more turquoise
        if (enableCrestColor > 0.5) {
            float crestFactor = smoothstep(0.3, 0.8, vWaveHeight / 0.5);
            color = mix(color, crestColor, crestFactor * crestColorStrength);
        }

        // Detail normals - surface ripples that fade with distance
        // LOD: Skip texture samples entirely when beyond fade distance
        vec3 detailN = vec3(0.0);
        if (enableDetailNormals > 0.5 && dist < detailNormalFadeEnd) {
            float detailFade = 1.0 - smoothstep(detailNormalFadeStart, detailNormalFadeEnd, dist);
            vec2 dnUV1 = vWorldPos.xz * detailNormalScale1 + time * 0.01;
            vec2 dnUV2 = vWorldPos.xz * detailNormalScale2 - time * 0.015;
            vec3 dn1 = texture2D(foamTexture, dnUV1).rgb * 2.0 - 1.0;
            vec3 dn2 = texture2D(foamTexture, dnUV2).rgb * 2.0 - 1.0;
            detailN = vec3((dn1.xy + dn2.xy) * detailNormalStrength * detailFade, 0.0);
        }

        // Simple lighting
        vec3 normal = normalize(vNormal + detailN);
        vec3 sunDir = normalize(sunDirection);
        float NdotL = max(dot(normal, sunDir), 0.0);

        // Fresnel effect - stronger at grazing angles
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.5);
        // Boost fresnel to have a higher base reflection
        fresnel = 0.2 + fresnel * 0.8;

        // Apply fresnel to alpha - more opaque at grazing angles (hides deep ocean floor)
        alpha = mix(alpha, 1.0, fresnel);

        // Environment map reflection (skip cubemap sampling on LOW quality)
        if (enableEnvMap > 0.5) {
            vec3 reflectDir = reflect(-viewDir, normal);
            // Flip Y for proper cubemap sampling
            reflectDir.y = abs(reflectDir.y);
            vec3 envReflection = textureCube(envMap, reflectDir).rgb;
            // Blend environment reflection based on fresnel
            color = mix(color, envReflection, fresnel * 0.6);
        } else {
            // LOW quality: use flat sky color instead of cubemap
            color = mix(color, vec3(0.5, 0.7, 0.9), fresnel * 0.5);
        }

        // Add subtle tinted sky reflection for more realistic look
        color = mix(color, vec3(0.6, 0.8, 1.0), fresnel * 0.25);

        // Sun specular
        vec3 halfDir = normalize(sunDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
        color += vec3(1.0, 0.95, 0.8) * spec * 0.5;

        // Shimmer - noise-based sparkles independent of sun angle
        // LOD: Only visible up close, skip at MEDIUM+ to save 2 texture samples
        if (enableGlitter > 0.5 && isClose) {
            // Multi-frequency noise for sparkle pattern
            float shimmer1 = texture2D(foamTexture, vWorldPos.xz * shimmerScale + time * shimmerSpeed).r;
            float shimmer2 = texture2D(foamTexture, vWorldPos.xz * shimmerScale * 2.3 - time * shimmerSpeed * 0.7).r;
            // Combine and threshold for sharp sparkles
            float shimmerCombined = shimmer1 * shimmer2;
            float sparkle = pow(shimmerCombined, 3.0) * shimmerStrength;
            // Modulate by normal variation for more realistic look
            float normalVar = abs(dot(normal, vec3(0.0, 1.0, 0.0)) - 0.98) * 50.0;
            sparkle *= clamp(normalVar, 0.0, 1.0);
            color += vec3(1.0, 0.98, 0.9) * sparkle;
        }

        // Wave crest glow - height-based, works with any sun angle
        // LOD: Skip noise texture at FAR to save 1 sample
        if (enableSSS > 0.5) {
            // Glow intensity based on wave height (crests glow more)
            float heightGlow = smoothstep(0.0, 0.4, vWaveHeight) * smoothstep(0.8, 0.4, vWaveHeight);
            float glow;
            if (isMedium) {
                // Full quality with noise variation
                float glowNoise = texture2D(foamTexture, vWorldPos.xz * 0.1 + time * 0.02).r;
                glow = heightGlow * (0.7 + glowNoise * 0.3) * sssStrength;
            } else {
                // Simplified - no noise sample at FAR
                glow = heightGlow * 0.85 * sssStrength;
            }
            color += sssColor * glow;
        }

        // === COLOR VARIATION === (large-scale patches in deeper water)
        // LOD: Skip at FAR - negligible visual impact at distance
        if (depth > 1.0 && isMedium) {
            float colorNoise = cheapNoise(vWorldPos.xz * 0.02 + time * 0.01);
            float deepFactor = smoothstep(1.0, 5.0, depth);
            color *= 0.9 + colorNoise * 0.2 * deepFactor;
        }

        // Diffuse lighting
        color *= 0.6 + NdotL * 0.4;

        // ========== FOAM SYSTEM ==========
        // Skip entire foam system on LOW quality to save many texture samples and calculations
        float foam = 0.0;
        if (enableFoam > 0.5) {

        if (depth > 0.0 && depth < foamMaxDepth * 3.0) {
            // Depth-based foam band
            float foamMidpoint = foamMaxDepth * 0.5;
            float fadeIn = smoothstep(0.0, foamMidpoint, depth);
            float fadeOut = 1.0 - smoothstep(foamMidpoint, foamMaxDepth * 3.0, depth);
            float depthFoamFactor = fadeIn * fadeOut;

            // Wave slope influence
            float waveFoamFactor = smoothstep(0.001, 0.02, vWaveSlope);
            foam = depthFoamFactor * mix(1.0, waveFoamFactor, foamWaveInfluence);

            // Subtle pulsing variation
            float foamPulse1 = sin(depth * 4.0 + foamTime * 2.5) * 0.5 + 0.5;
            float foamPulse2 = sin(depth * 6.0 + foamTime * 1.8 + vWorldPos.x * 0.1) * 0.5 + 0.5;
            float combinedPulse = foamPulse1 * 0.6 + foamPulse2 * 0.4;
            foam *= combinedPulse * 0.15 + 0.85;

            // === ENHANCED SHORE INTERACTION FOAM ===
            // LOD: CLOSE = full (3 noise samples), MEDIUM = simplified (1 sample), FAR = skip
            float shoreProximity = 1.0 - smoothstep(0.0, foamMaxDepth * 4.0, depth);
            if (shoreProximity > 0.01 && isMedium) {
                float shoreFoam = 0.0;

                if (isClose) {
                    // CLOSE: Full quality shore foam (3 noise samples)
                    float edgeNoise = cheapNoise(vWorldPos.xz * 0.5 + vec2(foamTime * 0.3)) * 2.0 - 1.0;

                    // Curved wave effect - waves emanating from moving origin
                    float waveOriginX = sin(foamTime * 0.3) * 20.0;
                    float waveOriginZ = cos(foamTime * 0.25) * 15.0;
                    float distFromOrigin = length(vWorldPos.xz - vec2(waveOriginX, waveOriginZ));
                    float curvedWave1 = sin(distFromOrigin * 0.08 - foamTime * 0.8) * 0.5 + 0.5;
                    float curvedWave2 = sin(distFromOrigin * 0.05 - foamTime * 0.6 + 1.57) * 0.5 + 0.5;
                    float waveRunUp = curvedWave1 * curvedWave2 * shoreProximity;

                    // Smooth foam line at shore edge
                    float depthWithNoise = depth + edgeNoise * (foamMaxDepth * 0.3);
                    float foamDecay = 1.0 / max(foamMaxDepth * 0.5, 0.1);
                    float smoothFoamLine = exp(-depthWithNoise * foamDecay) * 0.4;

                    // Foam patches in shallow water
                    float foamPatches = 0.0;
                    float softEdge = smoothstep(0.0, foamMaxDepth, depth);
                    if (softEdge > 0.0) {
                        float patchNoise = cheapNoise(vWorldPos.xz * 0.4 + vec2(foamTime * 0.6)) * 2.0 - 1.0;
                        foamPatches = max(0.0, patchNoise) * softEdge * 0.4;
                    }

                    // Combine shore foam effects
                    shoreFoam = (waveRunUp * 0.5 + smoothFoamLine + foamPatches) * 0.8;
                    float shoreFade = smoothstep(0.0, foamMaxDepth * 1.5, depth);
                    shoreFoam *= shoreFade;

                    // Continuous edge foam that doesn't fade out
                    float edgeFoamRange = foamMaxDepth * 2.0;
                    if (depth < edgeFoamRange) {
                        float edgeIntensity = 1.0 - smoothstep(0.0, edgeFoamRange, depth);
                        edgeIntensity = pow(edgeIntensity, 0.5);
                        float edgePattern = cheapNoise(vWorldPos.xz * 0.3 + foamTime * 0.2);
                        float edgeWave = sin(vWorldPos.x * 0.3 + foamTime * 2.0) *
                                       cos(vWorldPos.z * 0.25 + foamTime * 1.5);
                        edgeWave = edgeWave * 0.5 + 0.5;
                        float continuousEdgeFoam = edgeIntensity * edgePattern * edgeWave * 0.7;
                        shoreFoam = max(shoreFoam, continuousEdgeFoam);
                    }
                } else {
                    // MEDIUM: Simplified shore foam (1 noise sample)
                    float edgeNoise = cheapNoise(vWorldPos.xz * 0.5 + vec2(foamTime * 0.3)) * 2.0 - 1.0;
                    float depthWithNoise = depth + edgeNoise * (foamMaxDepth * 0.3);
                    float foamDecay = 1.0 / max(foamMaxDepth * 0.5, 0.1);
                    shoreFoam = exp(-depthWithNoise * foamDecay) * 0.5;
                }

                foam = foam + shoreFoam;
            }

            foam *= 1.5;
            foam = clamp(foam, 0.0, 1.0);

            // Limit foam to texture depth limit (reuse for texture blend)
            float foamDepthFade = 1.0 - smoothstep(foamTextureDepthLimit * 0.7, foamTextureDepthLimit, depth);
            foam *= foamDepthFade;

            // === MULTI-LAYER FOAM TEXTURE ===
            // LOD: CLOSE = 3 layers, MEDIUM = 1 layer, FAR = skip texturing
            if (foam > 0.0 && foamDepthFade > 0.01 && isMedium) {
                float foamTexCombined;

                if (isClose) {
                    // CLOSE: Full 3-layer foam texture
                    vec2 foamUV1 = vWorldPos.xz * foamTextureScale;
                    vec2 foamUV2 = vWorldPos.xz * foamTextureScale * 2.5;
                    vec2 foamUV3 = vWorldPos.xz * foamTextureScale * 5.0;

                    // Apply rotation to break up tiling patterns
                    if (abs(foamTextureRotation) > 0.001) {
                        float cosA = cos(foamTextureRotation);
                        float sinA = sin(foamTextureRotation);
                        mat2 rotMatrix = mat2(cosA, -sinA, sinA, cosA);
                        foamUV1 = rotMatrix * foamUV1;
                        foamUV2 = rotMatrix * foamUV2;
                        foamUV3 = rotMatrix * foamUV3;
                    }

                    // Animate each layer at similar slow speeds with slight variation
                    float baseSpeed = foamTextureSpeed * 0.01;
                    foamUV1 += vec2(foamTime * baseSpeed * 0.8, foamTime * baseSpeed * 0.7);
                    foamUV2 += vec2(foamTime * baseSpeed * 0.9, foamTime * baseSpeed * 0.75);
                    foamUV3 += vec2(foamTime * baseSpeed * 0.7, foamTime * baseSpeed * 0.85);

                    // Sample all three layers
                    float foamTex1 = texture2D(foamTexture, foamUV1).r;
                    float foamTex2 = texture2D(foamTexture, foamUV2).r;
                    float foamTex3 = texture2D(foamTexture, foamUV3).r;

                    // Consistent layer weighting for all depths (shore style everywhere)
                    float layer1Weight = 0.6;
                    float layer2Weight = 0.3;
                    float layer3Weight = 0.25;
                    float totalWeight = layer1Weight + layer2Weight + layer3Weight;

                    // Combine layers
                    foamTexCombined = (foamTex1 * layer1Weight +
                                       foamTex2 * layer2Weight +
                                       foamTex3 * layer3Weight) / totalWeight;
                } else {
                    // MEDIUM: Single layer foam texture (saves 2 samples)
                    vec2 foamUV1 = vWorldPos.xz * foamTextureScale;

                    if (abs(foamTextureRotation) > 0.001) {
                        float cosA = cos(foamTextureRotation);
                        float sinA = sin(foamTextureRotation);
                        mat2 rotMatrix = mat2(cosA, -sinA, sinA, cosA);
                        foamUV1 = rotMatrix * foamUV1;
                    }

                    float baseSpeed = foamTextureSpeed * 0.01;
                    foamUV1 += vec2(foamTime * baseSpeed * 0.8, foamTime * baseSpeed * 0.7);

                    foamTexCombined = texture2D(foamTexture, foamUV1).r;
                }

                foamTexCombined = clamp(foamTexCombined * foamTextureIntensity, 0.0, 2.0);

                // Blend texture with solid foam based on depth limit
                foamTexCombined = mix(1.0, foamTexCombined, foamDepthFade);

                foam *= foamTexCombined;
                foam = clamp(foam, 0.0, 1.0);
            }
            // FAR: No foam texture sampling, foam value used as-is
        }

        // Deep water whitecaps (outside shore foam zone)
        if (depth >= foamMaxDepth * 3.0 && foamWaveInfluence > 0.0) {
            float whitecapMin = whitecapThreshold * 0.4;  // Lower bound is 40% of threshold
            float whitecap = smoothstep(whitecapMin, whitecapThreshold, vWaveSlope);
            whitecap *= foamWaveInfluence;
            foam = whitecap * 0.4;
        }

        // Smooth foam fade based on continent mask (ocean = full foam, land = no foam)
        float oceanFoamFade = 1.0 - smoothstep(0.10, 0.30, continentMask);
        foam *= oceanFoamFade;

        } // end enableFoam

        // Blend foam into color
        color = mix(color, vec3(1.0), foam);
        alpha = mix(alpha, 1.0, foam);

        // Apply fog (must match terrain fog exactly - uses view-space depth)
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        color = mix(color, fogColor, fogFactor);

        // Distance-based alpha fade (matches terrain fade behavior)
        float distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, vFogDepth);
        // Discard fragments at fade distance (works for both transparent and opaque water)
        if (distanceFade < 0.01) {
            discard;
        }
        alpha *= distanceFade;

        // Apply shore fade with steeper curve for cleaner edge
        // pow() makes water fade out faster as it approaches shore
        float shoreFade = pow(1.0 - shoreBlend, 2.0);
        alpha *= shoreFade;

        // Ensure water is fully transparent when very close to shore
        if (shoreBlend > 0.9) {
            alpha *= smoothstep(0.99, 0.9, shoreBlend);
        }

        // When opaque (LOW quality), use discard instead of alpha fade at shore edges
        // since alpha is ignored for opaque materials
        if (isOpaque > 0.5 && shoreBlend > 0.7) {
            discard;
        }

        gl_FragColor = vec4(color, alpha);
    }
`;

// ============================================================================
// EXPORTED SHADER CHUNKS (for classes that need to build shaders)
// ============================================================================

export const SHADERS = {
    COMMON_UNIFORMS: SHADER_COMMON_UNIFORMS,
    NOISE: SHADER_NOISE,
    TEXTURES: SHADER_TEXTURES,
    PNG_TRIPLANAR: SHADER_PNG_TRIPLANAR,
    TERRAIN_COLOR: SHADER_TERRAIN_COLOR,
    NORMAL_PERTURBATION: SHADER_NORMAL_PERTURBATION,
    LIGHTING: SHADER_LIGHTING,
    FOG: SHADER_FOG,
    WATER_VERTEX: WATER_VERTEX_SHADER,
    WATER_FRAGMENT: WATER_FRAGMENT_SHADER,
};

// ============================================================================
// TERRAIN GENERATOR - Procedural height generation with continent system
// ============================================================================

export class TerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        this.perm = new Uint8Array(512);
        this.buildPermutationTable(seed);
        this.m00 = 0.8;  this.m01 = -0.6;
        this.m10 = 0.6;  this.m11 = 0.8;

        // Continent mask cache - stores precomputed continent influence values
        // Cell size of 16 gives good balance between accuracy and cache hits
        this.continentCacheSize = 16;
        this.continentCache = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;

        // Pre-compute min depth once
        this.minDepth = TERRAIN_CONFIG.OCEAN_MIN_DEPTH / TERRAIN_CONFIG.HEIGHT_SCALE;

        // Leveled areas for structure placement
        // Each area: { centerX, centerZ, halfWidth, halfDepth, targetHeight, cosR, sinR }
        this.leveledAreas = [];
    }

    buildPermutationTable(seed) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
        }
    }

    hash(ix, iy) {
        return this.perm[(ix & 255) + this.perm[iy & 255]] / 255.0;
    }

    // Deterministic hash for continent grid cells - uses permutation table for CPU/GPU consistency
    hashCell(x, y) {
        return this.hash(Math.floor(x), Math.floor(y));
    }

    // Second hash for variation - offset indices to get different values
    hashCell2(x, y) {
        return this.hash(Math.floor(x) + 123, Math.floor(y) + 456);
    }

    // Simple fast noise for radius variation
    fastNoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const ux = fx * fx * (3.0 - 2.0 * fx);
        const uy = fy * fy * (3.0 - 2.0 * fy);

        const a = this.hash(ix, iy);
        const b = this.hash(ix + 1, iy);
        const c = this.hash(ix, iy + 1);
        const d = this.hash(ix + 1, iy + 1);

        return (a * (1-ux) + b * ux) * (1-uy) + (c * (1-ux) + d * ux) * uy;
    }

    // Get cache key for a world position
    getCacheKey(cx, cz) {
        return (cx & 0xFFFF) | ((cz & 0xFFFF) << 16);
    }

    // Compute raw continent info (expensive - only called on cache miss)
    computeContinentInfo(worldX, worldZ) {
        const spacing = TERRAIN_CONFIG.CONTINENT_SPACING;
        const baseRadius = TERRAIN_CONFIG.CONTINENT_RADIUS;
        const radiusNoise = TERRAIN_CONFIG.CONTINENT_RADIUS_NOISE;

        const cellX = Math.floor(worldX / spacing);
        const cellZ = Math.floor(worldZ / spacing);

        let nearestDist = Infinity;
        let nearestRadius = baseRadius;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const cx = cellX + dx;
                const cz = cellZ + dz;

                const offsetX = this.hashCell(cx, cz);
                const offsetZ = this.hashCell2(cx, cz);
                const centerX = (cx + 0.2 + offsetX * 0.6) * spacing;
                const centerZ = (cz + 0.2 + offsetZ * 0.6) * spacing;

                const distX = worldX - centerX;
                const distZ = worldZ - centerZ;
                const dist = Math.sqrt(distX * distX + distZ * distZ);

                const n1 = this.fastNoise(centerX * 0.01, centerZ * 0.01);
                const n2 = this.fastNoise(centerX * 0.02 + 50, centerZ * 0.02 + 50);
                const noise = (n1 * 0.7 + n2 * 0.3) * 2 - 1;
                const noisyRadius = baseRadius * (1.0 + noise * radiusNoise);

                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestRadius = noisyRadius;
                }
            }
        }

        return { distance: nearestDist, radius: nearestRadius };
    }

    // Compute continent mask (0 = ocean, 1 = land) for a cache cell
    computeContinentMask(worldX, worldZ) {
        const continent = this.computeContinentInfo(worldX, worldZ);
        const transitionZone = TERRAIN_CONFIG.TRANSITION_ZONE;

        if (continent.distance <= continent.radius) {
            return 1.0;  // Full land
        }

        const transitionEnd = continent.radius + transitionZone;
        if (continent.distance <= transitionEnd) {
            const t = (continent.distance - continent.radius) / transitionZone;
            const smooth = t * t * (3 - 2 * t);
            return 1.0 - smooth;  // Transition zone
        }

        return 0.0;  // Ocean
    }

    // Get or compute cached continent mask for a cell
    getCachedMask(cx, cz) {
        const key = this.getCacheKey(cx, cz);

        if (this.continentCache.has(key)) {
            this.cacheHits++;
            return this.continentCache.get(key);
        }

        this.cacheMisses++;
        const cellSize = this.continentCacheSize;
        const worldX = (cx + 0.5) * cellSize;
        const worldZ = (cz + 0.5) * cellSize;
        const mask = this.computeContinentMask(worldX, worldZ);

        this.continentCache.set(key, mask);

        // Limit cache size to prevent memory bloat
        if (this.continentCache.size > 50000) {
            // Remove oldest entries (first 10000)
            const keys = this.continentCache.keys();
            for (let i = 0; i < 10000; i++) {
                this.continentCache.delete(keys.next().value);
            }
        }

        return mask;
    }

    // Fast continent mask lookup with bilinear interpolation
    getContinentMask(worldX, worldZ) {
        const cellSize = this.continentCacheSize;
        const fx = worldX / cellSize;
        const fz = worldZ / cellSize;
        const cx = Math.floor(fx);
        const cz = Math.floor(fz);
        const tx = fx - cx;
        const tz = fz - cz;

        // Get 4 corner values
        const v00 = this.getCachedMask(cx, cz);
        const v10 = this.getCachedMask(cx + 1, cz);
        const v01 = this.getCachedMask(cx, cz + 1);
        const v11 = this.getCachedMask(cx + 1, cz + 1);

        // Bilinear interpolation
        const v0 = v00 * (1 - tx) + v10 * tx;
        const v1 = v01 * (1 - tx) + v11 * tx;
        return v0 * (1 - tz) + v1 * tz;
    }

    // OPTIMIZATION: Inline noised() logic to avoid object allocation
    // The noised method created a new {x, y, z} object per call, causing GC stutters
    terrain(px, py) {
        let x = px, y = py, a = 0, b = 1, dx = 0, dy = 0;
        const octaves = TERRAIN_CONFIG.TERRAIN_OCTAVES;

        for (let i = 0; i < octaves; i++) {
            // INLINED NOISE LOGIC (avoids object allocation)
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
            const uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
            const dux = 30.0 * fx * fx * (fx * (fx - 2.0) + 1.0);
            const duy = 30.0 * fy * fy * (fy * (fy - 2.0) + 1.0);

            const hashA = this.hash(ix, iy);
            const hashB = this.hash(ix + 1, iy);
            const hashC = this.hash(ix, iy + 1);
            const hashD = this.hash(ix + 1, iy + 1);

            const k0 = hashA;
            const k1 = hashB - hashA;
            const k2 = hashC - hashA;
            const k3 = hashA - hashB - hashC + hashD;

            const noiseVal = -1.0 + 2.0 * (k0 + k1 * ux + k2 * uy + k3 * ux * uy);
            const noiseDerivX = 2.0 * dux * (k1 + k3 * uy);
            const noiseDerivY = 2.0 * duy * (k2 + k3 * ux);

            // Accumulate
            dx += noiseDerivX;
            dy += noiseDerivY;
            a += b * noiseVal / (1.0 + dx * dx + dy * dy);
            b *= 0.5;

            const nx = (this.m00 * x + this.m01 * y) * 2.0;
            const ny = (this.m10 * x + this.m11 * y) * 2.0;
            x = nx; y = ny;
        }
        return a;
    }

    // Returns normalized height (0-1 range, with ocean depths going negative)
    getHeight(worldX, worldZ) {
        const freq = TERRAIN_CONFIG.TERRAIN_FREQUENCY;
        const raw = this.terrain(worldX * freq, worldZ * freq);
        const terrainHeight = (raw + 1.0) * 0.5;

        // Fast cached continent mask lookup
        const continentMask = this.getContinentMask(worldX, worldZ);

        // Early exit for pure land (most common case)
        if (continentMask >= 0.999) {
            return terrainHeight;
        }

        // Early exit for pure ocean
        if (continentMask <= 0.001) {
            return Math.max(terrainHeight - 1.0, this.minDepth);
        }

        // Transition zone - blend based on mask
        const bias = (1.0 - continentMask) * 1.0;
        return Math.max(terrainHeight - bias, this.minDepth);
    }

    // Returns actual world height (multiplied by HEIGHT_SCALE)
    // Checks leveled areas and blends with procedural height
    getWorldHeight(worldX, worldZ) {
        const proceduralHeight = this.getHeight(worldX, worldZ) * TERRAIN_CONFIG.HEIGHT_SCALE;

        // Check leveled areas (structures flatten terrain)
        if (this.leveledAreas.length > 0) {
            const leveled = this.getLeveledHeight(worldX, worldZ, proceduralHeight);
            if (leveled !== null) {
                // Blend procedural with target based on blend factor
                const finalHeight = proceduralHeight * (1 - leveled.blend) + leveled.height * leveled.blend;
                return finalHeight;
            }
        }

        return proceduralHeight;
    }

    /**
     * Add a leveled area for structure placement
     * @param {number} centerX - World X center of structure
     * @param {number} centerZ - World Z center of structure
     * @param {number} width - Structure width
     * @param {number} depth - Structure depth
     * @param {number} targetHeight - Height to level terrain to
     * @param {number} rotation - Rotation in radians
     * @param {object} options - Optional settings
     * @param {boolean} options.raiseOnly - Only raise terrain below target (for docks)
     * @param {boolean} options.sharpEdges - No transition blending (90 degree edges)
     */
    addLeveledArea(centerX, centerZ, width, depth, targetHeight, rotation, options = {}) {
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        // Sharp edges don't need transition zone in maxReach
        const transitionZone = options.sharpEdges ? 0 : 1.2;

        // Detect axis-aligned rotation (0, 90, 180, 270 degrees)
        // Use small epsilon for floating-point comparison
        const epsilon = 0.001;
        const sinR = Math.sin(rotation);
        const cosR = Math.cos(rotation);
        const isAxisAligned = (Math.abs(sinR) < epsilon || Math.abs(cosR) < epsilon);

        let newArea;

        if (isAxisAligned) {
            // Pre-compute world-space bounding box for axis-aligned structures
            // Snap sin/cos to exact 0 or 1/-1 to avoid floating-point errors
            const snappedSin = Math.abs(sinR) < epsilon ? 0 : (sinR > 0 ? 1 : -1);
            const snappedCos = Math.abs(cosR) < epsilon ? 0 : (cosR > 0 ? 1 : -1);

            // Calculate world-space half-extents based on rotation
            // 0/180: width along X, depth along Z
            // 90/270: width along Z, depth along X
            const worldHalfX = Math.abs(snappedCos) * halfWidth + Math.abs(snappedSin) * halfDepth;
            const worldHalfZ = Math.abs(snappedSin) * halfWidth + Math.abs(snappedCos) * halfDepth;

            newArea = {
                centerX,
                centerZ,
                // World-space bounds (clean values, no floating-point trig errors)
                minX: centerX - worldHalfX,
                maxX: centerX + worldHalfX,
                minZ: centerZ - worldHalfZ,
                maxZ: centerZ + worldHalfZ,
                targetHeight,
                isAxisAligned: true,
                // Keep original values for removal matching and transition zones
                halfWidth,
                halfDepth,
                width,
                depth,
                rotation,
                raiseOnly: options.raiseOnly || false,
                sharpEdges: options.sharpEdges || false,
                // maxReach for AABB pre-filter
                maxReach: Math.max(worldHalfX, worldHalfZ) + transitionZone
            };
        } else {
            // Non-axis-aligned: use rotation-based approach
            newArea = {
                centerX,
                centerZ,
                halfWidth,
                halfDepth,
                targetHeight,
                cosR,
                sinR,
                isAxisAligned: false,
                // Precomputed for AABB optimization (diagonal + transition zone)
                maxReach: Math.sqrt(halfWidth * halfWidth + halfDepth * halfDepth) + transitionZone,
                width,
                depth,
                rotation,
                raiseOnly: options.raiseOnly || false,
                sharpEdges: options.sharpEdges || false
            };
        }

        this.leveledAreas.push(newArea);
    }

    /**
     * Remove a leveled area (for structure demolition)
     * @param {number} centerX - World X center
     * @param {number} centerZ - World Z center
     * @param {number} tolerance - Position tolerance for matching (default 0.5)
     * @returns {boolean} True if area was found and removed
     */
    removeLeveledArea(centerX, centerZ, tolerance = 0.5) {
        const idx = this.leveledAreas.findIndex(area =>
            Math.abs(area.centerX - centerX) < tolerance &&
            Math.abs(area.centerZ - centerZ) < tolerance
        );
        if (idx !== -1) {
            this.leveledAreas.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * Check if a point is in a leveled area and return blend info
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {number} proceduralHeight - Natural terrain height at this point
     * @returns {object|null} { height, blend } or null if not in any leveled area
     */
    getLeveledHeight(worldX, worldZ, proceduralHeight) {
        const transitionSize = 1.2;  // 1.2 unit transition zone (for non-sharp edges)

        for (const area of this.leveledAreas) {
            // AABB pre-filter: skip areas too far away
            if (Math.abs(worldX - area.centerX) > area.maxReach || Math.abs(worldZ - area.centerZ) > area.maxReach) {
                continue;
            }

            let edgeDist;

            if (area.isAxisAligned) {
                // Fast path: direct world-space bounds check (no rotation math)
                // Distance is positive if outside, negative if inside
                const distToMinX = area.minX - worldX;
                const distToMaxX = worldX - area.maxX;
                const distToMinZ = area.minZ - worldZ;
                const distToMaxZ = worldZ - area.maxZ;
                edgeDist = Math.max(distToMinX, distToMaxX, distToMinZ, distToMaxZ);
            } else {
                // Rotation-based path for non-axis-aligned structures
                const relX = worldX - area.centerX;
                const relZ = worldZ - area.centerZ;
                const structLocalX = relX * area.cosR + relZ * area.sinR;
                const structLocalZ = -relX * area.sinR + relZ * area.cosR;
                const distX = Math.abs(structLocalX);
                const distZ = Math.abs(structLocalZ);
                edgeDist = Math.max(distX - area.halfWidth, distZ - area.halfDepth);
            }

            if (edgeDist <= 0) {
                // Inside structure footprint - apply height filtering
                if (area.raiseOnly) {
                    // Raise-only mode (docks): only raise terrain BELOW target height
                    // Terrain already above target stays at current height
                    if (proceduralHeight >= area.targetHeight) {
                        return { height: proceduralHeight, blend: 1.0 };
                    }
                } else {
                    // Default mode: only lower terrain that is HIGHER than target
                    // Terrain already below target stays at current height
                    if (proceduralHeight <= area.targetHeight) {
                        return { height: proceduralHeight, blend: 1.0 };
                    }
                }
                return { height: area.targetHeight, blend: 1.0 };
            } else if (!area.sharpEdges && edgeDist <= transitionSize) {
                // In transition zone - apply height filtering first
                if (area.raiseOnly) {
                    if (proceduralHeight >= area.targetHeight) {
                        continue;  // Don't affect terrain above target in transition
                    }
                } else {
                    if (proceduralHeight <= area.targetHeight) {
                        continue;  // Don't affect terrain below target in transition
                    }
                }
                // Cubic ease-in (flat near structure, steep at edge)
                const t = edgeDist / transitionSize;
                return { height: area.targetHeight, blend: 1.0 - (t * t * t) };
            }
        }

        return null;  // Not in any leveled area
    }

    /**
     * Clear all leveled areas (for world reset)
     */
    clearLeveledAreas() {
        this.leveledAreas.length = 0;
    }

    // Get the Y component of the terrain normal (1 = flat, 0 = vertical cliff)
    // Used for tree placement - trees only spawn on gentle slopes
    getNormalY(worldX, worldZ, spacing = 0.5) {
        const hL = this.getHeight(worldX - spacing, worldZ);
        const hR = this.getHeight(worldX + spacing, worldZ);
        const hD = this.getHeight(worldX, worldZ - spacing);
        const hU = this.getHeight(worldX, worldZ + spacing);

        const nx = (hL - hR) * TERRAIN_CONFIG.HEIGHT_SCALE;
        const ny = 2.0 * spacing;
        const nz = (hD - hU) * TERRAIN_CONFIG.HEIGHT_SCALE;

        return ny / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
}

// ============================================================================
// SEAM MESH - Bridges T-junctions between clipmap levels
// ============================================================================

export class SeamMesh {
    constructor(levelIndex, fineLevel, coarseLevel, noise, heightScale) {
        this.levelIndex = levelIndex;
        this.fineSpacing = fineLevel.gridSpacing;
        this.coarseSpacing = coarseLevel.gridSpacing;
        this.boundaryDistance = fineLevel.halfExtent;
        this.noise = noise;
        this.heightScale = heightScale;
        this.fineLevel = fineLevel;
        this.coarseLevel = coarseLevel;

        this.fineVertsPerEdge = Math.round((2 * this.boundaryDistance) / this.fineSpacing) + 1;
        if (this.fineVertsPerEdge < 2) {
            console.warn('SeamMesh: fineVertsPerEdge must be >= 2, got', this.fineVertsPerEdge);
            this.fineVertsPerEdge = 2;
        }
        this.textureScale = 0.15;
        this.textureOctaves = 2;

        // Track where terrain data is centered (snaps per fine level's grid)
        this.dataCenterX = 0;
        this.dataCenterY = 0;
        this.initialized = false;

        this.createGeometry();
        this.createMaterial();

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        // Seams render between terrain levels to prevent z-fighting
        // Terrain levels: 100, 101, 102... Seams: 100.5, 101.5, 102.5...
        this.mesh.renderOrder = 100 + levelIndex + 0.5;
    }

    getEdgePositions(edge, t, halfSize, innerDist, outerDist) {
        let innerX, innerZ, outerX, outerZ;
        switch (edge) {
            case 0: // Top edge
                innerX = outerX = -halfSize + t * 2 * halfSize;
                innerZ = innerDist;
                outerZ = outerDist;
                break;
            case 1: // Right edge
                innerZ = outerZ = halfSize - t * 2 * halfSize;
                innerX = innerDist;
                outerX = outerDist;
                break;
            case 2: // Bottom edge
                innerX = outerX = halfSize - t * 2 * halfSize;
                innerZ = -innerDist;
                outerZ = -outerDist;
                break;
            case 3: // Left edge
                innerZ = outerZ = -halfSize + t * 2 * halfSize;
                innerX = -innerDist;
                outerX = -outerDist;
                break;
        }
        return { innerX, innerZ, outerX, outerZ };
    }

    createGeometry() {
        const n = this.fineVertsPerEdge;
        const halfSize = this.boundaryDistance;

        const innerDist = halfSize;
        const outerDist = halfSize + this.coarseSpacing;

        const positions = [];
        const indices = [];

        // Store LOCAL coordinates (relative to mesh center)
        for (let edge = 0; edge < 4; edge++) {
            const baseIdx = positions.length / 3;

            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const { innerX, innerZ, outerX, outerZ } = this.getEdgePositions(edge, t, halfSize, innerDist, outerDist);

                // LOCAL coordinates - will be offset by mesh.position
                positions.push(innerX, 0, innerZ);
                positions.push(outerX, 0, outerZ);
            }

            for (let i = 0; i < n - 1; i++) {
                const inner0 = baseIdx + i * 2;
                const outer0 = baseIdx + i * 2 + 1;
                const inner1 = baseIdx + (i + 1) * 2;
                const outer1 = baseIdx + (i + 1) * 2 + 1;

                indices.push(inner0, outer0, inner1);
                indices.push(inner1, outer0, outer1);
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(positions);
        this.normals = new Float32Array(positions.length);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
        this.geometry.setIndex(indices);

        this.vertexCount = positions.length / 3;
        this.triangleCount = indices.length / 3;
    }

    createMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                levelIndex: { value: this.levelIndex },
                heightScale: { value: this.heightScale },
                meshWorldOffset: { value: new THREE.Vector2(0, 0) },
                fogNear: { value: TERRAIN_CONFIG.FOG_NEAR },
                fogFar: { value: TERRAIN_CONFIG.FOG_FAR },
                fogColor: { value: new THREE.Vector3(0.6, 0.733, 0.867) },  // Matches scene fog 0x99bbdd
                fadeStart: { value: TERRAIN_CONFIG.TERRAIN_FADE_START },
                fadeEnd: { value: TERRAIN_CONFIG.TERRAIN_FADE_END },
                enableNormalPerturb: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_NORMAL_PERTURB },
                enableProceduralBlend: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_PROCEDURAL_BLEND },
                proceduralOctaves: { value: TERRAIN_CONFIG.TERRAIN_PROCEDURAL_OCTAVES },
                enableTriplanar: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_TRIPLANAR },
                sunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
                sandDark: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
                sandLight: { value: new THREE.Vector3(0.494, 0.341, 0.0) },
                grassDark: { value: new THREE.Vector3(0.584, 0.522, 0.196) },
                grassLight: { value: new THREE.Vector3(0.467, 0.451, 0.176) },  // #77732D
                rockDark: { value: new THREE.Vector3(0.25, 0.22, 0.2) },
                rockLight: { value: new THREE.Vector3(0.5, 0.45, 0.4) },
                snowDark: { value: new THREE.Vector3(0.85, 0.9, 0.98) },
                snowLight: { value: new THREE.Vector3(0.95, 0.97, 1.0) },
                textureScale: { value: this.textureScale },
                textureOctaves: { value: this.textureOctaves },
                // LOD texture uniforms (will be set by GeometryClipmap)
                texturesLoaded: { value: 0.0 },  // 0 = use procedural fallback, 1 = use PNG textures
                texGrass: { value: null },
                texGrass2: { value: null },
                texRock: { value: null },
                texSand: { value: null },
                texSand2: { value: null },
                texDirt: { value: null },
                texSnow: { value: null },
                textureLodNear: { value: 40.0 },
                textureLodFar: { value: 80.0 },
                textureRepeat: { value: 0.1 },
                // Dirt overlay uniforms (for structure/tree dirt patches)
                texDirtOverlay: { value: null },
                dirtOverlayCenter: { value: new THREE.Vector2(0, 0) },
                dirtOverlayRange: { value: 200.0 },
                // Road texture uniforms
                texRoad: { value: null },
                texYellowRoad: { value: null }
            },
            vertexShader: `
                uniform vec2 meshWorldOffset;

                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec2 vTexCoord;
                varying float vFogDepth;

                void main() {
                    vHeight = position.y;

                    // Stable texture coordinates (meshWorldOffset pre-wrapped on CPU with 64-bit precision)
                    vTexCoord = meshWorldOffset + position.xz;

                    // Compute world position from local + model matrix
                    vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos4.xyz;
                    vNormal = normal;
                    vec4 viewPos = viewMatrix * worldPos4;
                    vFogDepth = length(viewPos.xyz);  // Euclidean distance for uniform fog
                    gl_Position = projectionMatrix * viewPos;
                }
            `,
            fragmentShader: `
                uniform int levelIndex;
                uniform float textureScale;
                uniform int textureOctaves;
                ${SHADERS.COMMON_UNIFORMS}

                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec2 vTexCoord;
                varying float vFogDepth;

                ${SHADERS.NOISE}
                ${SHADERS.TEXTURES}
                ${SHADERS.PNG_TRIPLANAR}
                ${SHADERS.TERRAIN_COLOR}
                ${SHADERS.NORMAL_PERTURBATION}
                ${SHADERS.LIGHTING}
                ${SHADERS.FOG}

                void main() {
                    vec3 normal = normalize(vNormal);
                    float distToCamera = length(vWorldPos - cameraPosition);

                    // Use stable texture coordinates for noise sampling
                    vec3 stablePos = vec3(vTexCoord.x, vHeight, vTexCoord.y);

                    normal = perturbNormal(normal, stablePos, distToCamera);
                    float stableSlope = 1.0 - vNormal.y;
                    float slope = 1.0 - normal.y;

                    vec3 terrainColor = getTerrainTexture(stablePos, normal, vHeight, stableSlope, distToCamera, textureScale, textureOctaves);

                    vec3 sunDir = normalize(sunDirection);
                    float NdotL = max(dot(normal, sunDir), 0.0);

                    // Extra AO from slope variation (match ClipmapLevel)
                    float slopeVariation = length(vec2(dFdx(slope), dFdy(slope)));
                    float extraAO = 1.0 - smoothstep(0.0, 0.1, slopeVariation) * 0.3;

                    vec3 color = computeLighting(terrainColor, normal, vHeight, NdotL, extraAO);

                    // Rim lighting (match ClipmapLevel)
                    vec3 skyColor = vec3(0.4, 0.5, 0.7);
                    float rim = 1.0 - max(dot(normal, normalize(cameraPosition - vWorldPos)), 0.0);
                    rim = pow(rim, 3.0) * (1.0 - NdotL) * 0.15;
                    color += rim * skyColor;

                    color = applyFog(color, vFogDepth);

                    // Distance fade only for outermost seam (levelIndex 0)
                    // Inner seams output alpha=1.0 for proper depth sorting with water
                    float distanceFade = 1.0;
                    if (levelIndex == 0) {
                        distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, vFogDepth);
                    }

                    // Underwater fade: terrain fades out below water surface (y=0)
                    // This prevents z-fighting by making underwater terrain transparent
                    float underwaterFade = 1.0;
                    if (vHeight < 0.0) {
                        // Start fading at y=0, fully transparent at y=-2
                        underwaterFade = 1.0 - smoothstep(0.0, 2.0, -vHeight);
                    }

                    gl_FragColor = vec4(color, distanceFade * underwaterFade);
                }
            `,
            wireframe: TERRAIN_CONFIG.WIREFRAME,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
            // Fix z-fighting: seams use offset between terrain levels
            // Seams at 0.5, 1.5, 2.5... between terrain levels at 0, 1, 2...
            polygonOffset: true,
            polygonOffsetFactor: this.levelIndex + 0.5,
            polygonOffsetUnits: this.levelIndex + 1,
            // Only outermost seam (level 0) needs transparency for distance fade
            transparent: this.levelIndex === 0
        });
    }

    getTerrainHeight(worldX, worldZ) {
        // Use getWorldHeight to include leveled areas from structure placement
        return this.noise.getWorldHeight(worldX, worldZ);
    }

    sampleLevelHeight(level, worldX, worldZ) {
        if (!level || !level.initialized) {
            // Use getWorldHeight to include leveled areas (docks, structures)
            // Previously used getHeight which ignored leveled areas, causing
            // height discontinuities at seam boundaries when seams crossed structures
            return this.noise.getWorldHeight(worldX, worldZ);
        }

        const spacing = level.gridSpacing;
        const halfCells = (level.size - 1) / 2;

        const relX = (worldX - level.dataCenterX) / spacing + halfCells;
        const relY = (worldZ - level.dataCenterY) / spacing + halfCells;

        const gx0 = Math.floor(relX), gy0 = Math.floor(relY);
        const fx = relX - gx0, fy = relY - gy0;

        const cx0 = Math.max(0, Math.min(level.size - 1, gx0));
        const cy0 = Math.max(0, Math.min(level.size - 1, gy0));
        const cx1 = Math.max(0, Math.min(level.size - 1, gx0 + 1));
        const cy1 = Math.max(0, Math.min(level.size - 1, gy0 + 1));

        const h00 = level.heightData[cy0 * level.size + cx0];
        const h10 = level.heightData[cy0 * level.size + cx1];
        const h01 = level.heightData[cy1 * level.size + cx0];
        const h11 = level.heightData[cy1 * level.size + cx1];

        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    }

    sampleCoarseHeight(worldX, worldZ) {
        return this.sampleLevelHeight(this.coarseLevel, worldX, worldZ);
    }

    sampleFineHeight(worldX, worldZ) {
        return this.sampleLevelHeight(this.fineLevel, worldX, worldZ);
    }

    update(snappedX, snappedY) {
        // Use GLOBAL snapped position (passed from GeometryClipmap)
        // This ensures seam aligns with ALL levels, not just fine level
        this.mesh.position.set(snappedX, 0, snappedY);

        // Update mesh world offset for stable texture coordinates
        // Wrap on CPU with 64-bit precision to avoid GPU float32 precision loss at large distances
        this.material.uniforms.meshWorldOffset.value.set(wrapCoord(snappedX), wrapCoord(snappedY));

        // Only recalculate heights when position actually changed (but always on first frame)
        if (this.initialized && snappedX === this.dataCenterX && snappedY === this.dataCenterY) {
            return;
        }

        this.dataCenterX = snappedX;
        this.dataCenterY = snappedY;
        this.updateHeights(snappedX, snappedY);
        this.initialized = true;
    }

    updateHeights(realViewerX, realViewerY) {
        const n = this.fineVertsPerEdge;
        const halfSize = this.boundaryDistance;
        const innerDist = halfSize;
        const outerDist = halfSize + this.coarseSpacing;
        const fineSpacing = this.fineSpacing;
        const coarseSpacing = this.coarseSpacing;

        let vertIdx = 0;

        for (let edge = 0; edge < 4; edge++) {
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const { innerX, innerZ, outerX, outerZ } = this.getEdgePositions(edge, t, halfSize, innerDist, outerDist);

                // Inner vertex - sample from fine level
                const worldInnerX = realViewerX + innerX;
                const worldInnerZ = realViewerY + innerZ;
                const innerHeight = this.sampleFineHeight(worldInnerX, worldInnerZ);

                this.positions[vertIdx * 3] = innerX;
                this.positions[vertIdx * 3 + 1] = innerHeight;
                this.positions[vertIdx * 3 + 2] = innerZ;

                // Normal for inner vertex - use direct noise sampling to avoid bounds issues
                const hL = this.getTerrainHeight(worldInnerX - fineSpacing, worldInnerZ);
                const hR = this.getTerrainHeight(worldInnerX + fineSpacing, worldInnerZ);
                const hD = this.getTerrainHeight(worldInnerX, worldInnerZ - fineSpacing);
                const hU = this.getTerrainHeight(worldInnerX, worldInnerZ + fineSpacing);

                let nx = hL - hR;
                let ny = 2.0 * fineSpacing;
                let nz = hD - hU;
                let len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                this.normals[vertIdx * 3] = nx / len;
                this.normals[vertIdx * 3 + 1] = ny / len;
                this.normals[vertIdx * 3 + 2] = nz / len;
                vertIdx++;

                // Outer vertex - sample from coarse level
                const worldOuterX = realViewerX + outerX;
                const worldOuterZ = realViewerY + outerZ;
                const outerHeight = this.sampleCoarseHeight(worldOuterX, worldOuterZ);

                this.positions[vertIdx * 3] = outerX;
                this.positions[vertIdx * 3 + 1] = outerHeight;
                this.positions[vertIdx * 3 + 2] = outerZ;

                // Normal for outer vertex - use direct noise sampling to avoid bounds issues
                const hLO = this.getTerrainHeight(worldOuterX - coarseSpacing, worldOuterZ);
                const hRO = this.getTerrainHeight(worldOuterX + coarseSpacing, worldOuterZ);
                const hDO = this.getTerrainHeight(worldOuterX, worldOuterZ - coarseSpacing);
                const hUO = this.getTerrainHeight(worldOuterX, worldOuterZ + coarseSpacing);

                nx = hLO - hRO;
                ny = 2.0 * coarseSpacing;
                nz = hDO - hUO;
                len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                this.normals[vertIdx * 3] = nx / len;
                this.normals[vertIdx * 3 + 1] = ny / len;
                this.normals[vertIdx * 3 + 2] = nz / len;
                vertIdx++;
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.normal.needsUpdate = true;
        this.geometry.computeBoundingSphere();
    }

    setWireframe(wireframe) {
        this.material.wireframe = wireframe;
    }
}

// ============================================================================
// CLIPMAP LEVEL - Single LOD ring in geometry clipmap system
// ============================================================================

export class ClipmapLevel {
    constructor(level, size, worldScale, heightScale, noise, totalLevels) {
        // Validate size is 2^n + 1 for proper grid alignment
        const sizeExp = Math.log2(size - 1);
        if (!Number.isInteger(sizeExp) || sizeExp < 1) {
            console.warn(`ClipmapLevel: size ${size} should be 2^n + 1 (e.g., 33, 65, 129, 257)`);
        }

        this.level = level;
        this.size = size;
        this.totalLevels = totalLevels;
        this.gridSpacing = worldScale / (size - 1);
        this.worldScale = worldScale;
        this.heightScale = heightScale;
        this.noise = noise;
        this.halfExtent = worldScale / 2;

        if (level < totalLevels - 1) {
            this.innerCutoff = worldScale / 4;
        } else {
            this.innerCutoff = 0;
        }

        this.transitionWidth = TERRAIN_CONFIG.TRANSITION_WIDTH * this.halfExtent;

        // Track where terrain DATA is centered (snaps to grid)
        this.dataCenterX = 0;
        this.dataCenterY = 0;

        this.createGeometry();
        this.createMaterial(level);
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        // Terrain renders at 100+ to leave gap below for other objects
        // Water at 300 renders after terrain
        this.mesh.renderOrder = 100 + level;
        this.mesh.frustumCulled = false;

        this.heightData = new Float32Array(size * size);
        this.initialized = false;
        this.firstUpdate = true;
        this.forceInstantUpdate = false;  // When true, skip lerping (for structure placement)
        this.isStable = false;  // True when all display heights match target heights (no lerping needed)

        // Dirty vertex tracking for optimized lerping
        this.dirtyVertices = new Set();
        this.isLerping = false;
        this.positionsDirty = false;
    }

    createGeometry() {
        const size = this.size;
        const vertices = size * size;
        const spacing = this.gridSpacing;

        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(vertices * 3);
        this.normals = new Float32Array(vertices * 3);
        this.coarseNormals = new Float32Array(vertices * 3);
        this.coarseHeights = new Float32Array(vertices);
        this.targetHeights = new Float32Array(vertices);
        this.displayHeights = new Float32Array(vertices);

        // Initialize with LOCAL coordinates (relative to mesh center)
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                const localX = (x - (size - 1) / 2) * spacing;
                const localZ = (y - (size - 1) / 2) * spacing;

                this.positions[idx * 3] = localX;
                this.positions[idx * 3 + 1] = 0;
                this.positions[idx * 3 + 2] = localZ;
                this.normals[idx * 3] = 0;
                this.normals[idx * 3 + 1] = 1;
                this.normals[idx * 3 + 2] = 0;
                this.coarseNormals[idx * 3] = 0;
                this.coarseNormals[idx * 3 + 1] = 1;
                this.coarseNormals[idx * 3 + 2] = 0;
                this.targetHeights[idx] = 0;
                this.displayHeights[idx] = 0;
            }
        }

        const indices = [];
        for (let y = 0; y < size - 1; y++) {
            for (let x = 0; x < size - 1; x++) {
                const i0 = y * size + x;
                const i1 = y * size + x + 1;
                const i2 = (y + 1) * size + x;
                const i3 = (y + 1) * size + x + 1;

                if ((x + y) % 2 === 0) {
                    indices.push(i0, i2, i1);
                    indices.push(i1, i2, i3);
                } else {
                    indices.push(i0, i2, i3);
                    indices.push(i0, i3, i1);
                }
            }
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
        this.geometry.setAttribute('coarseNormal', new THREE.BufferAttribute(this.coarseNormals, 3));
        this.geometry.setAttribute('coarseHeight', new THREE.BufferAttribute(this.coarseHeights, 1));
        this.geometry.setIndex(indices);
        this.triangleCount = indices.length / 3;
    }

    createMaterial(level) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                levelIndex: { value: level },
                totalLevels: { value: this.totalLevels },
                innerCutoff: { value: this.innerCutoff },
                heightScale: { value: this.heightScale },
                blendStart: { value: this.halfExtent - this.transitionWidth },
                transitionWidth: { value: this.transitionWidth },
                viewerOffset: { value: new THREE.Vector2(0, 0) },
                meshWorldOffset: { value: new THREE.Vector2(0, 0) },
                fogNear: { value: TERRAIN_CONFIG.FOG_NEAR },
                fogFar: { value: TERRAIN_CONFIG.FOG_FAR },
                fogColor: { value: new THREE.Vector3(0.6, 0.733, 0.867) },  // Matches scene fog 0x99bbdd
                fadeStart: { value: TERRAIN_CONFIG.TERRAIN_FADE_START },
                fadeEnd: { value: TERRAIN_CONFIG.TERRAIN_FADE_END },
                enableNormalPerturb: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_NORMAL_PERTURB },
                enableProceduralBlend: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_PROCEDURAL_BLEND },
                proceduralOctaves: { value: TERRAIN_CONFIG.TERRAIN_PROCEDURAL_OCTAVES },
                enableTriplanar: { value: TERRAIN_CONFIG.TERRAIN_ENABLE_TRIPLANAR },
                sunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
                sandDark: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
                sandLight: { value: new THREE.Vector3(0.494, 0.341, 0.0) },
                grassDark: { value: new THREE.Vector3(0.584, 0.522, 0.196) },
                grassLight: { value: new THREE.Vector3(0.467, 0.451, 0.176) },  // #77732D
                rockDark: { value: new THREE.Vector3(0.25, 0.22, 0.2) },
                rockLight: { value: new THREE.Vector3(0.5, 0.45, 0.4) },
                snowDark: { value: new THREE.Vector3(0.85, 0.9, 0.98) },
                snowLight: { value: new THREE.Vector3(0.95, 0.97, 1.0) },
                // LOD texture uniforms (will be set by GeometryClipmap)
                texturesLoaded: { value: 0.0 },  // 0 = use procedural fallback, 1 = use PNG textures
                texGrass: { value: null },
                texGrass2: { value: null },
                texRock: { value: null },
                texSand: { value: null },
                texSand2: { value: null },
                texDirt: { value: null },
                texSnow: { value: null },
                textureLodNear: { value: 40.0 },
                textureLodFar: { value: 80.0 },
                textureRepeat: { value: 0.1 },
                // Dirt overlay uniforms (for structure/tree dirt patches)
                texDirtOverlay: { value: null },
                dirtOverlayCenter: { value: new THREE.Vector2(0, 0) },
                dirtOverlayRange: { value: 200.0 },
                // Road texture uniforms
                texRoad: { value: null },
                texYellowRoad: { value: null }
            },
            vertexShader: `
                attribute float coarseHeight;
                attribute vec3 coarseNormal;

                uniform float blendStart;
                uniform float transitionWidth;
                uniform vec2 viewerOffset;
                uniform vec2 meshWorldOffset;

                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec2 vTexCoord;
                varying float vFogDepth;

                void main() {
                    vec3 pos = position;

                    // Calculate morph alpha on GPU based on distance from real viewer
                    float distX = abs(pos.x - viewerOffset.x);
                    float distZ = abs(pos.z - viewerOffset.y);
                    float maxDist = max(distX, distZ);
                    float alpha = clamp((maxDist - blendStart) / transitionWidth, 0.0, 1.0);

                    float morphedHeight = mix(pos.y, coarseHeight, alpha);
                    pos.y = morphedHeight;

                    vec3 morphedNormal = normalize(mix(normal, coarseNormal, alpha));

                    vHeight = morphedHeight;
                    vLocalPos = pos;

                    // Stable texture coordinates (meshWorldOffset pre-wrapped on CPU with 64-bit precision)
                    vTexCoord = meshWorldOffset + pos.xz;

                    // Compute world position from local + model matrix
                    vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
                    vWorldPos = worldPos4.xyz;
                    vNormal = morphedNormal;

                    vec4 viewPos = viewMatrix * worldPos4;
                    vFogDepth = length(viewPos.xyz);  // Euclidean distance for uniform fog
                    gl_Position = projectionMatrix * viewPos;
                }
            `,
            fragmentShader: `
                uniform int levelIndex;
                uniform int totalLevels;
                uniform float innerCutoff;
                ${SHADERS.COMMON_UNIFORMS}

                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec2 vTexCoord;
                varying float vFogDepth;

                ${SHADERS.NOISE}
                ${SHADERS.TEXTURES}
                ${SHADERS.PNG_TRIPLANAR}
                ${SHADERS.TERRAIN_COLOR}
                ${SHADERS.NORMAL_PERTURBATION}
                ${SHADERS.LIGHTING}
                ${SHADERS.FOG}

                void main() {
                    // Use LOCAL position for discard (relative to mesh center = player position)
                    vec2 localDist = abs(vLocalPos.xz);
                    float maxDist = max(localDist.x, localDist.y);

                    float discardBoundary = innerCutoff;
                    // Larger margin (1.0) reduces overlap during morph transitions
                    bool shouldDiscard = (levelIndex < totalLevels - 1) &&
                                         (maxDist < discardBoundary - 1.0);

                    if (shouldDiscard) {
                        discard;
                    }

                    vec3 normal = normalize(vNormal);
                    float distToCamera = length(vWorldPos - cameraPosition);

                    // Use stable texture coordinates for noise sampling
                    vec3 stablePos = vec3(vTexCoord.x, vHeight, vTexCoord.y);

                    normal = perturbNormal(normal, stablePos, distToCamera);
                    float stableSlope = 1.0 - vNormal.y;
                    float slope = 1.0 - normal.y;

                    vec3 terrainColor = getTerrainTexture(stablePos, normal, vHeight, stableSlope, distToCamera, 0.15, 3);

                    vec3 sunDir = normalize(sunDirection);
                    float NdotL = max(dot(normal, sunDir), 0.0);

                    // Extra AO from slope variation (ClipmapLevel-specific)
                    float slopeVariation = length(vec2(dFdx(slope), dFdy(slope)));
                    float extraAO = 1.0 - smoothstep(0.0, 0.1, slopeVariation) * 0.3;

                    vec3 color = computeLighting(terrainColor, normal, vHeight, NdotL, extraAO);

                    // Rim lighting
                    vec3 skyColor = vec3(0.4, 0.5, 0.7);
                    float rim = 1.0 - max(dot(normal, normalize(cameraPosition - vWorldPos)), 0.0);
                    rim = pow(rim, 3.0) * (1.0 - NdotL) * 0.15;
                    color += rim * skyColor;

                    color = applyFog(color, vFogDepth);

                    // Distance fade only for outermost level (levelIndex 0)
                    // Inner levels output alpha=1.0 for proper depth sorting with water
                    float distanceFade = 1.0;
                    if (levelIndex == 0) {
                        distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, vFogDepth);
                    }

                    // Underwater fade: terrain fades out below water surface (y=0)
                    // This prevents z-fighting by making underwater terrain transparent
                    float underwaterFade = 1.0;
                    if (vHeight < 0.0) {
                        // Start fading at y=0, fully transparent at y=-2
                        underwaterFade = 1.0 - smoothstep(0.0, 2.0, -vHeight);
                    }

                    gl_FragColor = vec4(color, distanceFade * underwaterFade);
                }
            `,
            wireframe: TERRAIN_CONFIG.WIREFRAME,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
            // Fix z-fighting: push coarser levels back in depth buffer
            // Level 0 is coarsest (largest), level 5 is finest (smallest)
            polygonOffset: true,
            polygonOffsetFactor: level,           // 0, 1, 2, 3, 4, 5
            polygonOffsetUnits: level * 2,        // 0, 2, 4, 6, 8, 10
            // Only outermost level (0) needs transparency for distance fade
            // Inner levels are fully opaque, improving depth sorting
            transparent: level === 0
        });
    }

    getTerrainHeight(worldX, worldY) {
        // Use getWorldHeight to include leveled areas from structure placement
        return this.noise.getWorldHeight(worldX, worldY);
    }

    update(snappedCenterX, snappedCenterY, realViewerX, realViewerY, coarserLevel, deltaTime = 0.016) {
        const size = this.size;
        const spacing = this.gridSpacing;

        // Use GLOBAL snapped position for mesh position (ensures all levels align)
        this.mesh.position.set(snappedCenterX, 0, snappedCenterY);

        // Check if terrain data needs updating
        const deltaGridX = this.initialized ? Math.round((snappedCenterX - this.dataCenterX) / spacing) : 0;
        const deltaGridY = this.initialized ? Math.round((snappedCenterY - this.dataCenterY) / spacing) : 0;
        const needsUpdate = deltaGridX !== 0 || deltaGridY !== 0 || !this.initialized;

        if (needsUpdate) {
            const maxIncrementalShift = Math.floor(size / 4);
            const useIncremental = this.initialized &&
                Math.abs(deltaGridX) <= maxIncrementalShift &&
                Math.abs(deltaGridY) <= maxIncrementalShift;

            if (useIncremental) {
                this.incrementalUpdate(deltaGridX, deltaGridY, snappedCenterX, snappedCenterY, spacing, coarserLevel);
            } else {
                this.fullUpdate(snappedCenterX, snappedCenterY, spacing, coarserLevel);
                // Force instant lerp on large position changes (respawn/teleport)
                this.firstUpdate = true;
            }

            this.dataCenterX = snappedCenterX;
            this.dataCenterY = snappedCenterY;
            this.initialized = true;
        }

        // Lerp display heights toward targets
        const timeScale = deltaTime * 60.0;

        // Outer levels (0, 1, 2) skip lerping - height changes are imperceptible at distance
        // This saves ~50% CPU on per-vertex processing for distant terrain
        const outerLevelCount = Math.floor(this.totalLevels / 2);
        const skipLerping = this.level >= 0 && this.level < outerLevelCount;

        // Use instant update for structure placement, outer levels, or first frame
        const lerpSpeed = (this.firstUpdate || this.forceInstantUpdate || skipLerping)
            ? 1.0
            : TERRAIN_CONFIG.LOD_LERP_SPEED * timeScale;

        if (this.firstUpdate) {
            this.firstUpdate = false;
        }
        if (this.forceInstantUpdate) {
            this.forceInstantUpdate = false;
        }

        // Update viewer offset uniform for GPU-based morph alpha calculation
        const offsetX = realViewerX - snappedCenterX;
        const offsetY = realViewerY - snappedCenterY;
        this.material.uniforms.viewerOffset.value.set(offsetX, offsetY);

        // Update mesh world offset for stable texture coordinates
        // Wrap on CPU with 64-bit precision to avoid GPU float32 precision loss at large distances
        this.material.uniforms.meshWorldOffset.value.set(wrapCoord(snappedCenterX), wrapCoord(snappedCenterY));

        // Lerp display heights (morph alpha now calculated on GPU)
        // For outer levels with skipLerping=true, lerpSpeed=1.0 makes this instant
        let anyHeightChanged = false;
        for (let i = 0; i < this.displayHeights.length; i++) {
            const target = this.targetHeights[i];
            const current = this.displayHeights[i];
            const delta = target - current;
            if (Math.abs(delta) > 0.001) {
                this.displayHeights[i] = current + delta * lerpSpeed;
                anyHeightChanged = true;
            } else {
                this.displayHeights[i] = target;
            }
            this.positions[i * 3 + 1] = this.displayHeights[i];
        }

        // Track stability for buffer upload optimization
        const wasStable = this.isStable;
        this.isStable = !anyHeightChanged;

        // Update GPU buffers - only upload when geometry actually changed
        // Skip upload entirely if already stable (saves GPU bandwidth)
        if (anyHeightChanged || needsUpdate) {
            this.geometry.attributes.position.needsUpdate = true;
        } else if (!wasStable && this.isStable) {
            // One final upload when we stabilize to ensure final state is on GPU
            this.geometry.attributes.position.needsUpdate = true;
        }
        if (needsUpdate) {
            this.geometry.attributes.normal.needsUpdate = true;
            this.geometry.attributes.coarseNormal.needsUpdate = true;
            this.geometry.attributes.coarseHeight.needsUpdate = true;
            this.geometry.computeBoundingSphere();
        }
    }

    fullUpdate(dataCenterX, dataCenterY, spacing, coarserLevel) {
        const size = this.size;

        for (let gy = 0; gy < size; gy++) {
            for (let gx = 0; gx < size; gx++) {
                this.computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
            }
        }

        for (let gy = 0; gy < size; gy++) {
            for (let gx = 0; gx < size; gx++) {
                this.computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
            }
        }
    }

    incrementalUpdate(deltaGridX, deltaGridY, dataCenterX, dataCenterY, spacing, coarserLevel) {
        const size = this.size;

        this.shiftArrayData(deltaGridX, deltaGridY);

        if (deltaGridX > 0) {
            for (let gx = size - deltaGridX; gx < size; gx++) {
                for (let gy = 0; gy < size; gy++) {
                    this.computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        } else if (deltaGridX < 0) {
            for (let gx = 0; gx < -deltaGridX; gx++) {
                for (let gy = 0; gy < size; gy++) {
                    this.computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        }

        if (deltaGridY > 0) {
            for (let gy = size - deltaGridY; gy < size; gy++) {
                for (let gx = 0; gx < size; gx++) {
                    this.computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        } else if (deltaGridY < 0) {
            for (let gy = 0; gy < -deltaGridY; gy++) {
                for (let gx = 0; gx < size; gx++) {
                    this.computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        }

        // Increase margin to ensure boundary normals are recalculated against existing data
        const margin = 2;
        const xMin = deltaGridX > 0 ? Math.max(0, size - deltaGridX - margin) : 0;
        const xMax = deltaGridX < 0 ? Math.min(size, -deltaGridX + margin) : size;
        const yMin = deltaGridY > 0 ? Math.max(0, size - deltaGridY - margin) : 0;
        const yMax = deltaGridY < 0 ? Math.min(size, -deltaGridY + margin) : size;

        if (deltaGridX !== 0) {
            for (let gx = xMin; gx < xMax; gx++) {
                for (let gy = 0; gy < size; gy++) {
                    this.computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        }

        if (deltaGridY !== 0) {
            for (let gy = yMin; gy < yMax; gy++) {
                for (let gx = 0; gx < size; gx++) {
                    this.computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel);
                }
            }
        }
    }

    shiftArrayData(deltaGridX, deltaGridY) {
        const size = this.size;

        if (deltaGridY > 0) {
            const rowSize3 = size * 3;
            const rowSize1 = size;
            this.normals.copyWithin(0, deltaGridY * rowSize3);
            this.coarseNormals.copyWithin(0, deltaGridY * rowSize3);
            this.heightData.copyWithin(0, deltaGridY * rowSize1);
            this.coarseHeights.copyWithin(0, deltaGridY * rowSize1);
            this.targetHeights.copyWithin(0, deltaGridY * rowSize1);
            this.displayHeights.copyWithin(0, deltaGridY * rowSize1);
        } else if (deltaGridY < 0) {
            const shift = -deltaGridY;
            const rowSize3 = size * 3;
            const rowSize1 = size;
            this.normals.copyWithin(shift * rowSize3, 0, (size - shift) * rowSize3);
            this.coarseNormals.copyWithin(shift * rowSize3, 0, (size - shift) * rowSize3);
            this.heightData.copyWithin(shift * rowSize1, 0, (size - shift) * rowSize1);
            this.coarseHeights.copyWithin(shift * rowSize1, 0, (size - shift) * rowSize1);
            this.targetHeights.copyWithin(shift * rowSize1, 0, (size - shift) * rowSize1);
            this.displayHeights.copyWithin(shift * rowSize1, 0, (size - shift) * rowSize1);
        }

        if (deltaGridX > 0) {
            for (let row = 0; row < size; row++) {
                const rowStart3 = row * size * 3;
                const rowStart1 = row * size;
                this.normals.copyWithin(rowStart3, rowStart3 + deltaGridX * 3, rowStart3 + size * 3);
                this.coarseNormals.copyWithin(rowStart3, rowStart3 + deltaGridX * 3, rowStart3 + size * 3);
                this.heightData.copyWithin(rowStart1, rowStart1 + deltaGridX, rowStart1 + size);
                this.coarseHeights.copyWithin(rowStart1, rowStart1 + deltaGridX, rowStart1 + size);
                this.targetHeights.copyWithin(rowStart1, rowStart1 + deltaGridX, rowStart1 + size);
                this.displayHeights.copyWithin(rowStart1, rowStart1 + deltaGridX, rowStart1 + size);
            }
        } else if (deltaGridX < 0) {
            const shift = -deltaGridX;
            for (let row = 0; row < size; row++) {
                const rowStart3 = row * size * 3;
                const rowStart1 = row * size;
                // copyWithin handles overlapping regions correctly when dest > src
                this.normals.copyWithin(rowStart3 + shift * 3, rowStart3, rowStart3 + (size - shift) * 3);
                this.coarseNormals.copyWithin(rowStart3 + shift * 3, rowStart3, rowStart3 + (size - shift) * 3);
                this.heightData.copyWithin(rowStart1 + shift, rowStart1, rowStart1 + (size - shift));
                this.coarseHeights.copyWithin(rowStart1 + shift, rowStart1, rowStart1 + (size - shift));
                this.targetHeights.copyWithin(rowStart1 + shift, rowStart1, rowStart1 + (size - shift));
                this.displayHeights.copyWithin(rowStart1 + shift, rowStart1, rowStart1 + (size - shift));
            }
        }
    }

    computeVertexData(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel) {
        const size = this.size;
        const idx = gy * size + gx;

        // World position for height sampling
        const halfCells = (size - 1) / 2;
        const worldX = dataCenterX + (gx - halfCells) * spacing;
        const worldY = dataCenterY + (gy - halfCells) * spacing;

        const height = this.getTerrainHeight(worldX, worldY);

        let coarseHeight;
        if (coarserLevel && coarserLevel.initialized) {
            coarseHeight = this.sampleCoarseHeight(worldX, worldY, coarserLevel);
        } else {
            coarseHeight = height;
        }

        // LOCAL position (doesn't change when data center changes)
        const localX = (gx - halfCells) * spacing;
        const localZ = (gy - halfCells) * spacing;

        this.positions[idx * 3] = localX;
        this.positions[idx * 3 + 1] = coarseHeight;  // Start at coarse height
        this.positions[idx * 3 + 2] = localZ;
        this.targetHeights[idx] = height;
        this.displayHeights[idx] = coarseHeight;  // Display starts at coarse
        this.heightData[idx] = height;
        this.coarseHeights[idx] = coarseHeight;
    }

    computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel) {
        const size = this.size;
        const idx = gy * size + gx;

        const halfCells = (size - 1) / 2;
        const worldX = dataCenterX + (gx - halfCells) * spacing;
        const worldY = dataCenterY + (gy - halfCells) * spacing;

        // OPTIMIZATION: Try to read neighbors from existing heightData array
        // instead of re-computing expensive noise.
        let hL, hR, hD, hU;

        // Check Left
        if (gx > 0) hL = this.heightData[gy * size + (gx - 1)];
        else hL = this.getTerrainHeight(worldX - spacing, worldY);

        // Check Right
        if (gx < size - 1) hR = this.heightData[gy * size + (gx + 1)];
        else hR = this.getTerrainHeight(worldX + spacing, worldY);

        // Check Down
        if (gy > 0) hD = this.heightData[(gy - 1) * size + gx];
        else hD = this.getTerrainHeight(worldX, worldY - spacing);

        // Check Up
        if (gy < size - 1) hU = this.heightData[(gy + 1) * size + gx];
        else hU = this.getTerrainHeight(worldX, worldY + spacing);

        const nx = (hL - hR);
        const ny = 2.0 * spacing;
        const nz = (hD - hU);

        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        this.normals[idx * 3] = nx / len;
        this.normals[idx * 3 + 1] = ny / len;
        this.normals[idx * 3 + 2] = nz / len;

        if (coarserLevel && coarserLevel.initialized) {
            const coarseSpacing = coarserLevel.gridSpacing;
            const hLC = this.sampleCoarseHeight(worldX - coarseSpacing, worldY, coarserLevel);
            const hRC = this.sampleCoarseHeight(worldX + coarseSpacing, worldY, coarserLevel);
            const hDC = this.sampleCoarseHeight(worldX, worldY - coarseSpacing, coarserLevel);
            const hUC = this.sampleCoarseHeight(worldX, worldY + coarseSpacing, coarserLevel);

            const cnx = (hLC - hRC);
            const cny = 2.0 * coarseSpacing;
            const cnz = (hDC - hUC);

            const clen = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz);
            this.coarseNormals[idx * 3] = cnx / clen;
            this.coarseNormals[idx * 3 + 1] = cny / clen;
            this.coarseNormals[idx * 3 + 2] = cnz / clen;
        } else {
            this.coarseNormals[idx * 3] = this.normals[idx * 3];
            this.coarseNormals[idx * 3 + 1] = this.normals[idx * 3 + 1];
            this.coarseNormals[idx * 3 + 2] = this.normals[idx * 3 + 2];
        }
    }

    sampleCoarseHeight(worldX, worldY, coarserLevel) {
        const coarseSpacing = coarserLevel.gridSpacing;
        const coarseHalfCells = (coarserLevel.size - 1) / 2;

        const relX = (worldX - coarserLevel.dataCenterX) / coarseSpacing + coarseHalfCells;
        const relY = (worldY - coarserLevel.dataCenterY) / coarseSpacing + coarseHalfCells;

        const gx0 = Math.floor(relX), gy0 = Math.floor(relY);
        const fx = relX - gx0, fy = relY - gy0;

        const cx0 = Math.max(0, Math.min(coarserLevel.size - 1, gx0));
        const cy0 = Math.max(0, Math.min(coarserLevel.size - 1, gy0));
        const cx1 = Math.max(0, Math.min(coarserLevel.size - 1, gx0 + 1));
        const cy1 = Math.max(0, Math.min(coarserLevel.size - 1, gy0 + 1));

        // Use heightData (actual computed heights) instead of displayHeights (lerped)
        // displayHeights may not have converged yet after structure placement,
        // causing incorrect coarse heights to be morphed into fine level at LOD boundaries
        const h00 = coarserLevel.heightData[cy0 * coarserLevel.size + cx0];
        const h10 = coarserLevel.heightData[cy0 * coarserLevel.size + cx1];
        const h01 = coarserLevel.heightData[cy1 * coarserLevel.size + cx0];
        const h11 = coarserLevel.heightData[cy1 * coarserLevel.size + cx1];

        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    }

    getHeightAt(worldX, worldY) {
        return this.getTerrainHeight(worldX, worldY);
    }
}

// ============================================================================
// GEOMETRY CLIPMAP MANAGER - Orchestrates all terrain LOD levels
// ============================================================================

export class GeometryClipmap {
    constructor(scene, terrainGenerator = null) {
        this.scene = scene;
        this.levels = [];
        this.seamMeshes = [];
        // Use provided terrainGenerator or create a new one
        this.noise = terrainGenerator || new TerrainGenerator(12345);
        this.terrainTextures = {};
        // Reusable Vector2 to avoid per-frame allocations
        this._dirtOverlayCenter = new THREE.Vector2();

        this.createLevels();
        this.createSeamMeshes();
        this.loadTerrainTextures();
    }

    // Load PNG textures for near-camera detail
    loadTerrainTextures() {
        const loader = new THREE.TextureLoader();
        const texturePath = 'terrain/';

        const textureSettings = (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = 4;  // Reduces blurring at angles
            return texture;
        };

        // Core textures required for terrain rendering (count toward loaded state)
        const coreTextures = {
            texGrass: 'grass.png',
            texGrass2: 'grass2.png',
            texRock: 'rock.png',
            texSand: 'sand.png',
            texSand2: 'sand2.png',
            texDirt: 'dirt.png',
            texSnow: 'snow.png'
        };

        // Optional textures (roads) - don't block terrain rendering
        const optionalTextures = {
            texRoad: 'road.png',
            texYellowRoad: 'yellowroad.png'
        };

        // Track loading progress for core textures
        let loadedCount = 0;
        const totalRequired = Object.keys(coreTextures).length;

        // Helper: load texture with retry on failure (exponential backoff)
        const loadWithRetry = (uniformName, filename, isCore, attempt = 1) => {
            const maxDelay = 30000; // Cap retry delay at 30 seconds
            const baseDelay = 2000; // Start with 2 second delay

            loader.load(
                texturePath + filename,
                (texture) => {
                    textureSettings(texture);
                    this.terrainTextures[uniformName] = texture;
                    this.applyTextureToMaterials(uniformName, texture);

                    if (isCore) {
                        loadedCount++;
                        if (loadedCount >= totalRequired) {
                            // All core textures loaded - enable PNG sampling in shader
                            this.setTexturesLoaded(1.0);
                        }
                    }
                },
                undefined,
                (error) => {
                    // Calculate delay with exponential backoff, capped at maxDelay
                    const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), maxDelay);
                    console.warn(`Failed to load terrain texture ${filename} (attempt ${attempt}), retrying in ${(delay/1000).toFixed(1)}s...`);

                    setTimeout(() => {
                        loadWithRetry(uniformName, filename, isCore, attempt + 1);
                    }, delay);
                }
            );
        };

        // Load core textures with retry
        for (const [uniformName, filename] of Object.entries(coreTextures)) {
            loadWithRetry(uniformName, filename, true);
        }

        // Load optional textures with retry
        for (const [uniformName, filename] of Object.entries(optionalTextures)) {
            loadWithRetry(uniformName, filename, false);
        }
    }

    // Apply a loaded texture to all terrain materials
    applyTextureToMaterials(uniformName, texture) {
        for (const level of this.levels) {
            if (level.material.uniforms[uniformName]) {
                level.material.uniforms[uniformName].value = texture;
            }
        }
        for (const seam of this.seamMeshes) {
            if (seam.material.uniforms[uniformName]) {
                seam.material.uniforms[uniformName].value = texture;
            }
        }
    }

    // Set texturesLoaded uniform on all terrain materials
    // Called when all core textures finish loading to enable PNG sampling
    setTexturesLoaded(value) {
        for (const level of this.levels) {
            if (level.material.uniforms.texturesLoaded) {
                level.material.uniforms.texturesLoaded.value = value;
            }
        }
        for (const seam of this.seamMeshes) {
            if (seam.material.uniforms.texturesLoaded) {
                seam.material.uniforms.texturesLoaded.value = value;
            }
        }
    }

    createLevels() {
        const numLevels = TERRAIN_CONFIG.CLIPMAP_LEVELS;
        const innerSize = TERRAIN_CONFIG.CLIPMAP_SIZE;
        const outerSize = TERRAIN_CONFIG.CLIPMAP_SIZE_OUTER;
        const baseScale = TERRAIN_CONFIG.TERRAIN_SCALE;

        // Outer levels (0, 1, 2) use reduced resolution - they're far away
        const outerLevelCount = Math.floor(numLevels / 2);

        const hiddenLevelScale = baseScale * Math.pow(2, numLevels);
        const hiddenLevel = new ClipmapLevel(-1, outerSize, hiddenLevelScale, TERRAIN_CONFIG.HEIGHT_SCALE, this.noise, numLevels + 1);
        hiddenLevel.mesh.visible = false;
        this.levels.push(hiddenLevel);
        this.scene.add(hiddenLevel.mesh);

        for (let i = 0; i < numLevels; i++) {
            const levelScale = baseScale * Math.pow(2, numLevels - 1 - i);
            // Use reduced resolution for outer half of levels (levels 0, 1, 2)
            const isOuterLevel = i < outerLevelCount;
            const size = isOuterLevel ? outerSize : innerSize;
            const level = new ClipmapLevel(i, size, levelScale, TERRAIN_CONFIG.HEIGHT_SCALE, this.noise, numLevels);
            this.levels.push(level);
            this.scene.add(level.mesh);
        }

        // Store coarsest spacing for global snap alignment (like terrain3.html)
        this.coarsestSpacing = this.levels[0].gridSpacing;
    }

    createSeamMeshes() {
        for (let i = 0; i < this.levels.length - 1; i++) {
            const coarseLevel = this.levels[i];
            const fineLevel = this.levels[i + 1];

            const seamMesh = new SeamMesh(
                i,
                fineLevel,
                coarseLevel,
                this.noise,
                TERRAIN_CONFIG.HEIGHT_SCALE
            );

            this.seamMeshes.push(seamMesh);
            this.scene.add(seamMesh.mesh);
        }
    }

    update(viewerX, viewerY, deltaTime = 0.016) {
        // CRITICAL: Snap ALL levels to the SAME grid (coarsest spacing)
        // This ensures seams align perfectly with both adjacent levels
        const snapGrid = this.coarsestSpacing;
        const snappedX = Math.round(viewerX / snapGrid) * snapGrid;
        const snappedY = Math.round(viewerY / snapGrid) * snapGrid;

        // Update clipmap levels - pass snapped position for grid alignment
        for (let i = 0; i < this.levels.length; i++) {
            const coarserLevel = i > 0 ? this.levels[i - 1] : null;
            this.levels[i].update(snappedX, snappedY, viewerX, viewerY, coarserLevel, deltaTime);
        }

        // Update seam meshes - also use snapped position
        for (const seamMesh of this.seamMeshes) {
            seamMesh.update(snappedX, snappedY);
        }

        // Sync dirt overlay uniforms every frame (ensures shader has correct center after spawn)
        if (this.dirtOverlay) {
            this.updateDirtOverlayUniforms();
        }
    }

    getHeightAt(worldX, worldY) {
        return this.noise.getHeight(worldX, worldY) * TERRAIN_CONFIG.HEIGHT_SCALE;
    }

    getStats() {
        let totalTriangles = 0;
        let activeLevels = 0;
        let stableLevels = 0;

        for (const level of this.levels) {
            if (level.mesh.visible) {
                totalTriangles += level.triangleCount;
                activeLevels++;
                if (level.isStable) stableLevels++;
            }
        }

        for (const seam of this.seamMeshes) {
            if (seam.mesh.visible) {
                totalTriangles += seam.triangleCount;
            }
        }

        return {
            triangles: totalTriangles,
            activeLevels,
            stableLevels,
            bufferUploadsSkipped: stableLevels,  // Stable levels don't upload buffers
            totalLevels: this.levels.length
        };
    }

    /**
     * Force terrain refresh in a region (for terrain leveling after structure placement)
     * @param {number} centerX - World X center of affected region
     * @param {number} centerZ - World Z center of affected region
     * @param {number} radius - Radius of affected region
     */
    forceRefreshRegion(centerX, centerZ, radius) {
        // Mark affected levels for full update on next frame
        // Inner levels (higher index = finer detail) are most likely affected
        for (let i = this.levels.length - 1; i >= 0; i--) {
            const level = this.levels[i];

            // Check if this level's current mesh position overlaps the affected region
            const levelHalfExtent = level.halfExtent;
            const levelCenterX = level.mesh.position.x;
            const levelCenterZ = level.mesh.position.z;

            // Simple AABB overlap test
            const overlapX = Math.abs(levelCenterX - centerX) < (levelHalfExtent + radius);
            const overlapZ = Math.abs(levelCenterZ - centerZ) < (levelHalfExtent + radius);

            if (overlapX && overlapZ) {
                // Force full rebuild on next update with instant height update (no wave animation)
                level.initialized = false;
                level.forceInstantUpdate = true;
            }
        }

        // Also refresh seam meshes
        for (const seam of this.seamMeshes) {
            seam.initialized = false;
        }
    }

    setWireframe(wireframe) {
        for (const level of this.levels) {
            level.material.wireframe = wireframe;
        }
        for (const seam of this.seamMeshes) {
            seam.setWireframe(wireframe);
        }
    }

    setSeamsVisible(visible) {
        for (const seam of this.seamMeshes) {
            seam.mesh.visible = visible;
        }
    }

    setSunDirection(sunDir) {
        for (const level of this.levels) {
            level.material.uniforms.sunDirection.value.copy(sunDir);
        }
        for (const seam of this.seamMeshes) {
            seam.material.uniforms.sunDirection.value.copy(sunDir);
        }
    }

    // Helper to set uniform across all levels and seams
    _setUniform(name, value, useCopy = false) {
        for (const level of this.levels) {
            if (useCopy) {
                level.material.uniforms[name].value.copy(value);
            } else {
                level.material.uniforms[name].value = value;
            }
        }
        for (const seam of this.seamMeshes) {
            if (useCopy) {
                seam.material.uniforms[name].value.copy(value);
            } else {
                seam.material.uniforms[name].value = value;
            }
        }
    }

    setFogColor(r, g, b) {
        // Set directly on existing Vector3 to avoid allocation
        for (const level of this.levels) {
            level.material.uniforms.fogColor.value.set(r, g, b);
        }
        for (const seam of this.seamMeshes) {
            seam.material.uniforms.fogColor.value.set(r, g, b);
        }
    }

    setFogNear(value) {
        this._setUniform('fogNear', value);
    }

    setFogFar(value) {
        this._setUniform('fogFar', value);
    }

    setSandColors(dark, light) {
        this._setUniform('sandDark', dark, true);
        this._setUniform('sandLight', light, true);
    }

    setGrassColors(dark, light) {
        this._setUniform('grassDark', dark, true);
        this._setUniform('grassLight', light, true);
    }

    setRockColors(dark, light) {
        this._setUniform('rockDark', dark, true);
        this._setUniform('rockLight', light, true);
    }

    setSnowColors(dark, light) {
        this._setUniform('snowDark', dark, true);
        this._setUniform('snowLight', light, true);
    }

    // Texture LOD settings
    setTextureLodNear(value) {
        this._setUniform('textureLodNear', value);
    }

    setTextureLodFar(value) {
        this._setUniform('textureLodFar', value);
    }

    setTextureRepeat(value) {
        this._setUniform('textureRepeat', value);
    }

    // Get terrain meshes for raycasting (returns array of meshes from all visible levels)
    getTerrainMeshes() {
        const meshes = [];
        for (const level of this.levels) {
            if (level.mesh && level.mesh.visible) {
                meshes.push(level.mesh);
            }
        }
        return meshes;
    }

    /**
     * Set the dirt overlay system reference
     * @param {DirtOverlaySystem} dirtOverlay - The dirt overlay system instance
     */
    setDirtOverlay(dirtOverlay) {
        this.dirtOverlay = dirtOverlay;

        // Apply initial texture to all materials
        if (dirtOverlay && dirtOverlay.texture) {
            this.applyTextureToMaterials('texDirtOverlay', dirtOverlay.texture);
        }

        // Pass the snap grid to dirt overlay for synchronized center alignment
        if (dirtOverlay && this.coarsestSpacing) {
            dirtOverlay.setSnapGrid(this.coarsestSpacing);
        }
    }

    /**
     * Update dirt overlay uniforms (call after overlay center changes)
     */
    updateDirtOverlayUniforms() {
        if (!this.dirtOverlay) return;

        // centerX/Z are already wrapped in DirtOverlaySystem.setCenter()
        // Reuse _dirtOverlayCenter to avoid per-frame allocations
        this._dirtOverlayCenter.set(this.dirtOverlay.centerX, this.dirtOverlay.centerZ);
        const range = this.dirtOverlay.worldRange;

        for (const level of this.levels) {
            if (level.material.uniforms.dirtOverlayCenter) {
                level.material.uniforms.dirtOverlayCenter.value.copy(this._dirtOverlayCenter);
            }
            if (level.material.uniforms.dirtOverlayRange) {
                level.material.uniforms.dirtOverlayRange.value = range;
            }
        }
        for (const seam of this.seamMeshes) {
            if (seam.material.uniforms.dirtOverlayCenter) {
                seam.material.uniforms.dirtOverlayCenter.value.copy(this._dirtOverlayCenter);
            }
            if (seam.material.uniforms.dirtOverlayRange) {
                seam.material.uniforms.dirtOverlayRange.value = range;
            }
        }
    }
}

// ============================================================================
// DEPTH TEXTURE SYSTEM - Renders terrain height to texture for water depth
// ============================================================================

export class DepthTextureSystem {
    constructor(terrainGenerator) {
        // Render target for depth - use float format for better precision
        this.renderTarget = new THREE.WebGLRenderTarget(
            TERRAIN_CONFIG.DEPTH_TEXTURE_SIZE,
            TERRAIN_CONFIG.DEPTH_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.FloatType
            }
        );

        // Center position (tracks where depth texture is centered)
        this.center = new THREE.Vector2(0, 0);

        // Track last snapped position for optimization
        this.lastSnappedX = null;
        this.lastSnappedZ = null;

        // Simple orthographic camera for fullscreen quad
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // Fullscreen quad geometry
        this.quadGeometry = new THREE.PlaneGeometry(2, 2);

        // Create scene just for depth rendering
        this.depthScene = new THREE.Scene();

        // Create permutation texture from terrain generator's perm table
        // This ensures GPU uses identical hash values as CPU
        const permData = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
            permData[i] = terrainGenerator.perm[i];
        }
        const permTexture = new THREE.DataTexture(permData, 512, 1, THREE.RedFormat, THREE.UnsignedByteType);
        permTexture.minFilter = THREE.NearestFilter;
        permTexture.magFilter = THREE.NearestFilter;
        permTexture.needsUpdate = true;

        // Depth material - computes height per-pixel in fragment shader
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                depthCenter: { value: new THREE.Vector2(0, 0) },
                depthRange: { value: TERRAIN_CONFIG.DEPTH_RANGE },
                heightScale: { value: TERRAIN_CONFIG.HEIGHT_SCALE },
                terrainFrequency: { value: TERRAIN_CONFIG.TERRAIN_FREQUENCY },
                heightMin: { value: TERRAIN_CONFIG.DEPTH_HEIGHT_MIN },
                heightMax: { value: TERRAIN_CONFIG.DEPTH_HEIGHT_MAX },
                continentSpacing: { value: TERRAIN_CONFIG.CONTINENT_SPACING },
                continentRadius: { value: TERRAIN_CONFIG.CONTINENT_RADIUS },
                continentRadiusNoise: { value: TERRAIN_CONFIG.CONTINENT_RADIUS_NOISE },
                transitionZone: { value: TERRAIN_CONFIG.TRANSITION_ZONE },
                oceanMinDepth: { value: TERRAIN_CONFIG.OCEAN_MIN_DEPTH },
                seed: { value: terrainGenerator.seed },
                permTexture: { value: permTexture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec2 depthCenter;
                uniform float depthRange;
                uniform float heightScale;
                uniform float terrainFrequency;
                uniform float heightMin;
                uniform float heightMax;
                uniform float continentSpacing;
                uniform float continentRadius;
                uniform float continentRadiusNoise;
                uniform float transitionZone;
                uniform float oceanMinDepth;
                uniform float seed;
                uniform sampler2D permTexture;

                varying vec2 vUv;

                // Hash function using permutation table - matches CPU exactly
                // perm[(ix & 255) + perm[iy & 255]] / 255.0
                float hash(int ix, int iy) {
                    // Handle negative coordinates properly (GLSL bitwise AND on negatives is undefined)
                    int iy_wrapped = iy - int(floor(float(iy) / 256.0)) * 256;
                    int perm_iy = int(texture2D(permTexture, vec2((float(iy_wrapped) + 0.5) / 512.0, 0.5)).r * 255.0 + 0.5);
                    int ix_wrapped = ix - int(floor(float(ix) / 256.0)) * 256;
                    int idx = ix_wrapped + perm_iy;
                    return texture2D(permTexture, vec2((float(idx) + 0.5) / 512.0, 0.5)).r;
                }

                // Hash for continent cell positioning - uses permutation table for CPU/GPU consistency
                float hashCell(float x, float y) {
                    return hash(int(x), int(y));
                }

                float hashCell2(float x, float y) {
                    return hash(int(x) + 123, int(y) + 456);
                }

                float fastNoise(float x, float y) {
                    int ix = int(floor(x));
                    int iy = int(floor(y));
                    float fx = x - floor(x);
                    float fy = y - floor(y);
                    float ux = fx * fx * (3.0 - 2.0 * fx);
                    float uy = fy * fy * (3.0 - 2.0 * fy);

                    float a = hash(ix, iy);
                    float b = hash(ix + 1, iy);
                    float c = hash(ix, iy + 1);
                    float d = hash(ix + 1, iy + 1);

                    return (a * (1.0 - ux) + b * ux) * (1.0 - uy) + (c * (1.0 - ux) + d * ux) * uy;
                }

                vec2 getContinentInfo(vec2 worldPos) {
                    float cellX = floor(worldPos.x / continentSpacing);
                    float cellZ = floor(worldPos.y / continentSpacing);

                    float nearestDist = 1000000.0;
                    float nearestRadius = continentRadius;

                    for (int dx = -1; dx <= 1; dx++) {
                        for (int dz = -1; dz <= 1; dz++) {
                            float cx = cellX + float(dx);
                            float cz = cellZ + float(dz);

                            float offsetX = hashCell(cx, cz);
                            float offsetZ = hashCell2(cx, cz);
                            float centerX = (cx + 0.2 + offsetX * 0.6) * continentSpacing;
                            float centerZ = (cz + 0.2 + offsetZ * 0.6) * continentSpacing;

                            float distX = worldPos.x - centerX;
                            float distZ = worldPos.y - centerZ;
                            float dist = sqrt(distX * distX + distZ * distZ);

                            float n1 = fastNoise(centerX * 0.01, centerZ * 0.01);
                            float n2 = fastNoise(centerX * 0.02 + 50.0, centerZ * 0.02 + 50.0);
                            float noise = (n1 * 0.7 + n2 * 0.3) * 2.0 - 1.0;
                            float noisyRadius = continentRadius * (1.0 + noise * continentRadiusNoise);

                            if (dist < nearestDist) {
                                nearestDist = dist;
                                nearestRadius = noisyRadius;
                            }
                        }
                    }

                    return vec2(nearestDist, nearestRadius);
                }

                // Noise with derivatives (quintic interpolation) - matches CPU exactly
                vec3 noised(vec2 p) {
                    int ix = int(floor(p.x));
                    int iy = int(floor(p.y));
                    float fx = p.x - floor(p.x);
                    float fy = p.y - floor(p.y);

                    float ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
                    float uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
                    float dux = 30.0 * fx * fx * (fx * (fx - 2.0) + 1.0);
                    float duy = 30.0 * fy * fy * (fy * (fy - 2.0) + 1.0);

                    float a = hash(ix, iy);
                    float b = hash(ix + 1, iy);
                    float c = hash(ix, iy + 1);
                    float d = hash(ix + 1, iy + 1);

                    float k0 = a;
                    float k1 = b - a;
                    float k2 = c - a;
                    float k3 = a - b - c + d;

                    float value = -1.0 + 2.0 * (k0 + k1 * ux + k2 * uy + k3 * ux * uy);
                    vec2 deriv = 2.0 * vec2(dux, duy) * (vec2(k1, k2) + k3 * vec2(uy, ux));

                    return vec3(value, deriv);
                }

                // Rotation matrix - GLSL mat2 is column-major, matches CPU rotation
                const mat2 m = mat2(0.8, 0.6, -0.6, 0.8);

                float terrain(vec2 p) {
                    float a = 0.0;
                    float b = 1.0;
                    vec2 d = vec2(0.0);

                    for (int i = 0; i < 6; i++) {
                        vec3 n = noised(p);
                        d += n.yz;
                        a += b * n.x / (1.0 + dot(d, d));
                        b *= 0.5;
                        p = m * p * 2.0;
                    }

                    return a;
                }

                // Compute raw continent mask for a single point (0 = ocean, 1 = land)
                float computeContinentMask(vec2 worldXZ) {
                    vec2 continent = getContinentInfo(worldXZ);
                    float dist = continent.x;
                    float radius = continent.y;

                    if (dist <= radius) {
                        return 1.0;  // Full land
                    }

                    float transitionEnd = radius + transitionZone;
                    if (dist <= transitionEnd) {
                        float t = (dist - radius) / transitionZone;
                        float smoothT = t * t * (3.0 - 2.0 * t);
                        return 1.0 - smoothT;  // Transition zone
                    }

                    return 0.0;  // Ocean
                }

                // Get continent mask with bilinear interpolation matching CPU exactly
                // CPU caches masks at 16-unit cell boundaries and interpolates between them
                const float CACHE_CELL_SIZE = 16.0;

                float getContinentMask(vec2 worldXZ) {
                    // Convert to cell coordinates (matching CPU's cellSize = 16)
                    float fx = worldXZ.x / CACHE_CELL_SIZE;
                    float fz = worldXZ.y / CACHE_CELL_SIZE;
                    float cx = floor(fx);
                    float cz = floor(fz);
                    float tx = fx - cx;
                    float tz = fz - cz;

                    // Sample at 4 cell centers (CPU samples at cell center: (cx + 0.5) * cellSize)
                    vec2 p00 = vec2((cx + 0.5) * CACHE_CELL_SIZE, (cz + 0.5) * CACHE_CELL_SIZE);
                    vec2 p10 = vec2((cx + 1.5) * CACHE_CELL_SIZE, (cz + 0.5) * CACHE_CELL_SIZE);
                    vec2 p01 = vec2((cx + 0.5) * CACHE_CELL_SIZE, (cz + 1.5) * CACHE_CELL_SIZE);
                    vec2 p11 = vec2((cx + 1.5) * CACHE_CELL_SIZE, (cz + 1.5) * CACHE_CELL_SIZE);

                    float v00 = computeContinentMask(p00);
                    float v10 = computeContinentMask(p10);
                    float v01 = computeContinentMask(p01);
                    float v11 = computeContinentMask(p11);

                    // Bilinear interpolation (matching CPU exactly)
                    float v0 = v00 * (1.0 - tx) + v10 * tx;
                    float v1 = v01 * (1.0 - tx) + v11 * tx;
                    return v0 * (1.0 - tz) + v1 * tz;
                }

                float getHeight(vec2 worldXZ) {
                    vec2 terrainUV = worldXZ * terrainFrequency;
                    float raw = terrain(terrainUV);
                    float terrainHeight = (raw + 1.0) * 0.5;

                    float continentMask = getContinentMask(worldXZ);
                    float minDepth = oceanMinDepth / heightScale;

                    // Match CPU algorithm exactly
                    if (continentMask >= 0.999) {
                        return terrainHeight * heightScale;
                    }

                    if (continentMask <= 0.001) {
                        return max(terrainHeight - 1.0, minDepth) * heightScale;
                    }

                    // Transition zone - blend based on mask
                    float bias = (1.0 - continentMask) * 1.0;
                    return max(terrainHeight - bias, minDepth) * heightScale;
                }

                void main() {
                    // Convert UV to world position
                    // UV (0,0) is bottom-left, (1,1) is top-right
                    // World: center is at depthCenter, extends depthRange/2 in each direction
                    vec2 worldXZ = depthCenter + (vUv - 0.5) * depthRange;
                    // Flip Z because UV.y increases upward but world Z convention
                    worldXZ.y = depthCenter.y - (vUv.y - 0.5) * depthRange;

                    float height = getHeight(worldXZ);

                    float normalizedHeight = (height - heightMin) / (heightMax - heightMin);
                    normalizedHeight = clamp(normalizedHeight, 0.0, 1.0);
                    float continentMaskOut = getContinentMask(worldXZ);
                    gl_FragColor = vec4(normalizedHeight, continentMaskOut, 0.0, 1.0);
                }
            `
        });

        // Create the quad mesh
        this.quad = new THREE.Mesh(this.quadGeometry, this.material);
        this.depthScene.add(this.quad);

        // Flag to track if we need initial render
        this.needsInitialRender = true;
    }

    // Call this once renderer is available to initialize the depth texture
    initialize(renderer) {
        if (this.needsInitialRender) {
            // Render initial depth texture at origin
            this.render(renderer, null, 0, 0, null, null, null);
            this.needsInitialRender = false;
        }
    }

    render(renderer, viewerX, viewerZ) {
        // Snap center to texel grid for stability
        // Higher multiplier = less frequent updates (better for LOW quality)
        const texelSize = TERRAIN_CONFIG.DEPTH_RANGE / TERRAIN_CONFIG.DEPTH_TEXTURE_SIZE;
        const snapSize = texelSize * TERRAIN_CONFIG.DEPTH_SNAP_MULTIPLIER;
        const snappedX = Math.floor(viewerX / snapSize) * snapSize;
        const snappedZ = Math.floor(viewerZ / snapSize) * snapSize;

        // OPTIMIZATION: If the snapped position hasn't changed,
        // the texture is identical to the last frame. Skip rendering.
        if (this.lastSnappedX === snappedX && this.lastSnappedZ === snappedZ && !this.needsInitialRender) {
            return;
        }

        this.lastSnappedX = snappedX;
        this.lastSnappedZ = snappedZ;

        this.center.set(snappedX, snappedZ);

        // Update shader uniform with new center
        this.material.uniforms.depthCenter.value.set(snappedX, snappedZ);

        // Render fullscreen quad to depth texture
        const originalRenderTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(this.renderTarget);
        renderer.render(this.depthScene, this.camera);
        renderer.setRenderTarget(originalRenderTarget);
    }

    get texture() {
        return this.renderTarget.texture;
    }
}

// ============================================================================
// WATER SYSTEM - Manages water chunks with Gerstner waves
// ============================================================================

export class WaterSystem {
    constructor(scene, depthSystem, foamTexture) {
        this.scene = scene;
        this.depthSystem = depthSystem;
        this.foamTexture = foamTexture;
        this.chunks = new Map();
        this.time = 0;
        this.foamTime = 0;

        // Convert wave configs to Vector4s (dirX, dirZ, steepness, wavelength)
        this.waveA = this.waveToVec4(TERRAIN_CONFIG.WAVE_A);
        this.waveB = this.waveToVec4(TERRAIN_CONFIG.WAVE_B);
        this.waveC = this.waveToVec4(TERRAIN_CONFIG.WAVE_C);
        this.waveD = this.waveToVec4(TERRAIN_CONFIG.WAVE_D);

        // Pre-calculate wave constants for getWaveHeight() optimization
        this._waveParamsA = this._precomputeWaveParams(this.waveA);
        this._waveParamsB = this._precomputeWaveParams(this.waveB);

        // Default sun direction (will be updated by Application)
        this.sunDirection = new THREE.Vector3(0.5, 0.7, 0.5).normalize();

        // Fog settings (must match terrain and scene fog 0x99bbdd)
        this.fogColor = new THREE.Vector3(0.6, 0.733, 0.867);

        // Track current uniform values for new chunks
        this.currentUniforms = {
            waterColor: new THREE.Vector3(0.18, 0.52, 0.46),
            waveDampingMinDepth: TERRAIN_CONFIG.WAVE_DAMPING_MIN_DEPTH,
            waveDampingMaxDepth: TERRAIN_CONFIG.WAVE_DAMPING_MAX_DEPTH,
            foamMaxDepth: TERRAIN_CONFIG.FOAM_MAX_DEPTH,
            foamWaveInfluence: TERRAIN_CONFIG.FOAM_WAVE_INFLUENCE,
            foamTextureScale: TERRAIN_CONFIG.FOAM_TEXTURE_SCALE,
            foamTextureSpeed: TERRAIN_CONFIG.FOAM_TEXTURE_SPEED,
            foamTextureIntensity: TERRAIN_CONFIG.FOAM_TEXTURE_INTENSITY,
            foamTextureRotation: TERRAIN_CONFIG.FOAM_TEXTURE_ROTATION * Math.PI / 180,
            foamTextureDepthLimit: TERRAIN_CONFIG.FOAM_TEXTURE_DEPTH_LIMIT,
            whitecapThreshold: 0.1,

            // Effect toggles (read from config for quality gating)
            enableSSS: TERRAIN_CONFIG.WATER_ENABLE_SSS,
            enableDetailNormals: TERRAIN_CONFIG.WATER_ENABLE_DETAIL_NORMALS,
            enableCrestColor: TERRAIN_CONFIG.WATER_ENABLE_CREST_COLOR,
            enableGlitter: TERRAIN_CONFIG.WATER_ENABLE_GLITTER,
            enableDeepColor: TERRAIN_CONFIG.WATER_ENABLE_DEEP_COLOR,
            enableFoam: TERRAIN_CONFIG.WATER_ENABLE_FOAM,
            enableEnvMap: TERRAIN_CONFIG.WATER_ENABLE_ENV_MAP,

            // SSS params (wave crest glow)
            sssStrength: 0.1,
            sssColor: new THREE.Vector3(0.1, 0.4, 0.35),

            // Detail normal params
            detailNormalStrength: 1.0,
            detailNormalScale1: 0.01,
            detailNormalScale2: 0.02,
            detailNormalFadeStart: 10.0,
            detailNormalFadeEnd: 400.0,

            // Crest color params
            crestColorStrength: 0.25,
            crestColor: new THREE.Vector3(0.2, 0.55, 0.5),

            // Shimmer params (noise-based sparkles)
            shimmerStrength: 1.25,
            shimmerScale: 0.05,
            shimmerSpeed: 0.01,

            // Deep water color
            deepWaterColor: new THREE.Vector3(0.02, 0.12, 0.22),
            deepColorDepth: 12.0
        };

        // Environment map for reflections (set by Application after sky is created)
        this.envMap = null;

        // PERFORMANCE: Cached Set to avoid allocation every frame
        this._neededChunks = new Set();

        // PERFORMANCE: Track last depth texture/center to avoid unnecessary uniform updates
        this._lastDepthTexture = null;
        this._lastDepthCenterX = null;
        this._lastDepthCenterY = null;
    }

    waveToVec4(wave) {
        const dir = wave.direction * Math.PI / 180;
        return new THREE.Vector4(
            Math.sin(dir), Math.cos(dir),
            wave.steepness, wave.wavelength
        );
    }

    // Pre-compute wave parameters for getWaveHeight() optimization
    // Avoids sqrt() and division per wave per call
    _precomputeWaveParams(wave) {
        const PI = Math.PI;
        const dirX = wave.x;
        const dirZ = wave.y;
        const steepness = wave.z;
        const wavelength = wave.w;

        const k = 2.0 * PI / wavelength;
        const c = Math.sqrt(9.8 / k);
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

        return {
            k: k,
            c: c,
            dX: dirX / len,
            dZ: dirZ / len,
            a: steepness / k  // amplitude
        };
    }

    // PERFORMANCE: Use numeric key to avoid string allocation
    // Key format: cx * 100000 + cz (supports -50000 to +50000 range)
    _chunkKey(cx, cz) {
        return (cx + 50000) * 100000 + (cz + 50000);
    }

    createChunk(cx, cz) {
        const key = this._chunkKey(cx, cz);
        if (this.chunks.has(key)) return;

        // Create plane geometry (rotated to be horizontal)
        const geometry = new THREE.PlaneGeometry(
            TERRAIN_CONFIG.WATER_CHUNK_SIZE,
            TERRAIN_CONFIG.WATER_CHUNK_SIZE,
            TERRAIN_CONFIG.WATER_SEGMENTS,
            TERRAIN_CONFIG.WATER_SEGMENTS
        );
        geometry.rotateX(-Math.PI / 2);

        // Create shader material with all uniforms
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                waveA: { value: this.waveA.clone() },
                waveB: { value: this.waveB.clone() },
                waveC: { value: this.waveC.clone() },
                waveD: { value: this.waveD.clone() },
                waveCount: { value: TERRAIN_CONFIG.WATER_WAVE_COUNT },

                depthTexture: { value: this.depthSystem.texture },
                depthCenter: { value: this.depthSystem.center },
                depthRange: { value: TERRAIN_CONFIG.DEPTH_RANGE },
                depthHeightMin: { value: TERRAIN_CONFIG.DEPTH_HEIGHT_MIN },
                depthHeightMax: { value: TERRAIN_CONFIG.DEPTH_HEIGHT_MAX },
                waveDampingMinDepth: { value: this.currentUniforms.waveDampingMinDepth },
                waveDampingMaxDepth: { value: this.currentUniforms.waveDampingMaxDepth },

                waterColor: { value: this.currentUniforms.waterColor.clone() },
                fogColor: { value: this.fogColor.clone() },
                fogNear: { value: TERRAIN_CONFIG.FOG_NEAR },
                fogFar: { value: TERRAIN_CONFIG.FOG_FAR },
                fadeStart: { value: TERRAIN_CONFIG.TERRAIN_FADE_START },
                fadeEnd: { value: TERRAIN_CONFIG.TERRAIN_FADE_END },
                sunDirection: { value: this.sunDirection.clone() },

                // Environment map for reflections
                envMap: { value: this.envMap },

                foamTexture: { value: this.foamTexture },
                foamMaxDepth: { value: this.currentUniforms.foamMaxDepth },
                foamWaveInfluence: { value: this.currentUniforms.foamWaveInfluence },
                foamTextureScale: { value: this.currentUniforms.foamTextureScale },
                foamTextureSpeed: { value: this.currentUniforms.foamTextureSpeed },
                foamTextureIntensity: { value: this.currentUniforms.foamTextureIntensity },
                foamTextureRotation: { value: this.currentUniforms.foamTextureRotation },
                foamTextureDepthLimit: { value: this.currentUniforms.foamTextureDepthLimit },
                foamTime: { value: 0 },
                whitecapThreshold: { value: this.currentUniforms.whitecapThreshold },

                // Effect toggles
                enableSSS: { value: this.currentUniforms.enableSSS },
                enableDetailNormals: { value: this.currentUniforms.enableDetailNormals },
                enableCrestColor: { value: this.currentUniforms.enableCrestColor },
                enableGlitter: { value: this.currentUniforms.enableGlitter },
                enableDeepColor: { value: this.currentUniforms.enableDeepColor },
                enableFoam: { value: this.currentUniforms.enableFoam },
                enableEnvMap: { value: this.currentUniforms.enableEnvMap },

                // SSS params
                sssStrength: { value: this.currentUniforms.sssStrength },
                sssColor: { value: this.currentUniforms.sssColor.clone() },

                // Detail normal params
                detailNormalStrength: { value: this.currentUniforms.detailNormalStrength },
                detailNormalScale1: { value: this.currentUniforms.detailNormalScale1 },
                detailNormalScale2: { value: this.currentUniforms.detailNormalScale2 },
                detailNormalFadeStart: { value: this.currentUniforms.detailNormalFadeStart },
                detailNormalFadeEnd: { value: this.currentUniforms.detailNormalFadeEnd },

                // Crest color params
                crestColorStrength: { value: this.currentUniforms.crestColorStrength },
                crestColor: { value: this.currentUniforms.crestColor.clone() },

                // Shimmer params
                shimmerStrength: { value: this.currentUniforms.shimmerStrength },
                shimmerScale: { value: this.currentUniforms.shimmerScale },
                shimmerSpeed: { value: this.currentUniforms.shimmerSpeed },

                // Deep water color
                deepWaterColor: { value: this.currentUniforms.deepWaterColor.clone() },
                deepColorDepth: { value: this.currentUniforms.deepColorDepth },

                // Opaque mode flag (for LOW quality - uses discard instead of alpha fade)
                isOpaque: { value: TERRAIN_CONFIG.WATER_TRANSPARENT < 0.5 ? 1.0 : 0.0 }
            },
            vertexShader: SHADERS.WATER_VERTEX,
            fragmentShader: SHADERS.WATER_FRAGMENT,
            // On LOW quality, use opaque water to reduce overdraw and blending cost
            transparent: TERRAIN_CONFIG.WATER_TRANSPARENT > 0.5,
            depthWrite: TERRAIN_CONFIG.WATER_TRANSPARENT < 0.5, // Write depth when opaque
            side: THREE.DoubleSide,
            // Polygon offset prevents z-fighting at shore edges where surfaces are nearly coplanar
            // Use small offset (4) to push water slightly back, but not so far that terrain renders on top
            // Note: Large offsets (10-20) caused underwater terrain to render through water on LOW quality
            polygonOffset: true,
            polygonOffsetFactor: TERRAIN_CONFIG.WATER_POLYGON_OFFSET || 4,
            polygonOffsetUnits: TERRAIN_CONFIG.WATER_POLYGON_OFFSET || 4
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position at chunk center (water surface at y=0)
        mesh.position.set(
            cx * TERRAIN_CONFIG.WATER_CHUNK_SIZE + TERRAIN_CONFIG.WATER_CHUNK_SIZE / 2,
            0,
            cz * TERRAIN_CONFIG.WATER_CHUNK_SIZE + TERRAIN_CONFIG.WATER_CHUNK_SIZE / 2
        );

        // Water renders after all terrain (100-106) and seams
        mesh.renderOrder = 300;

        this.scene.add(mesh);
        this.chunks.set(key, mesh);
    }

    removeChunk(key) {
        const mesh = this.chunks.get(key);
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.chunks.delete(key);
        }
    }

    update(viewerX, viewerZ, deltaTime) {
        this.time += deltaTime;
        this.foamTime += deltaTime;

        // Calculate which chunks should exist
        const chunkX = Math.floor(viewerX / TERRAIN_CONFIG.WATER_CHUNK_SIZE);
        const chunkZ = Math.floor(viewerZ / TERRAIN_CONFIG.WATER_CHUNK_SIZE);

        // PERFORMANCE: Reuse cached Set instead of allocating new one
        this._neededChunks.clear();
        const radius = TERRAIN_CONFIG.WATER_CHUNKS_RADIUS;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const cx = chunkX + dx;
                const cz = chunkZ + dz;
                // PERFORMANCE: Use numeric keys instead of string concatenation
                this._neededChunks.add(this._chunkKey(cx, cz));
            }
        }

        // Remove unneeded chunks
        for (const key of this.chunks.keys()) {
            if (!this._neededChunks.has(key)) {
                this.removeChunk(key);
            }
        }

        // Create new chunks - need to iterate with coordinates
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const cx = chunkX + dx;
                const cz = chunkZ + dz;
                const key = this._chunkKey(cx, cz);
                if (!this.chunks.has(key)) {
                    this.createChunk(cx, cz);
                }
            }
        }

        // PERFORMANCE: Check if depth texture/center changed before updating those uniforms
        const depthChanged = this.depthSystem.texture !== this._lastDepthTexture ||
                             this.depthSystem.center.x !== this._lastDepthCenterX ||
                             this.depthSystem.center.y !== this._lastDepthCenterY;

        if (depthChanged) {
            this._lastDepthTexture = this.depthSystem.texture;
            this._lastDepthCenterX = this.depthSystem.center.x;
            this._lastDepthCenterY = this.depthSystem.center.y;
        }

        // PERFORMANCE: Only update time uniforms every frame
        // Depth and sun uniforms are updated only when they change
        for (const mesh of this.chunks.values()) {
            const uniforms = mesh.material.uniforms;
            // Time always updates (animation)
            uniforms.time.value = this.time;
            uniforms.foamTime.value = this.foamTime;

            // Depth uniforms only when depth system changes (player moves significantly)
            if (depthChanged) {
                uniforms.depthTexture.value = this.depthSystem.texture;
                uniforms.depthCenter.value = this.depthSystem.center;
            }
            // Note: sunDirection is updated via setSunDirection() only when sun moves
        }
    }

    setSunDirection(dir) {
        this.sunDirection.copy(dir).normalize();
        for (const mesh of this.chunks.values()) {
            mesh.material.uniforms.sunDirection.value.copy(this.sunDirection);
        }
    }

    setFogColor(color) {
        this.fogColor.set(color.x, color.y, color.z);
        for (const mesh of this.chunks.values()) {
            mesh.material.uniforms.fogColor.value.copy(this.fogColor);
        }
    }

    setEnvMap(envMap) {
        this.envMap = envMap;
        for (const mesh of this.chunks.values()) {
            mesh.material.uniforms.envMap.value = envMap;
        }
    }

    // Calculate Gerstner wave height at a given world position
    // Matches the vertex shader formula exactly for accurate ship bobbing
    // Uses pre-computed wave parameters for performance
    getWaveHeight(x, z) {
        let totalY = 0;

        // Use pre-computed wave parameters (avoids sqrt/division per call)
        const waves = [this._waveParamsA, this._waveParamsB];
        for (const w of waves) {
            // Phase: f = k * (dot(d, position.xz) - c * time * 0.5)
            const f = w.k * ((w.dX * x + w.dZ * z) - w.c * this.time * 0.5);
            // Y displacement is amplitude * sin(f)
            totalY += w.a * Math.sin(f);
        }

        return totalY;
    }

    // Update a tracked uniform value (for GUI persistence)
    setUniform(name, value) {
        // Track the value
        if (typeof value === 'object' && value.clone) {
            this.currentUniforms[name] = value.clone();
        } else {
            this.currentUniforms[name] = value;
        }
        // Apply to all existing chunks
        for (const mesh of this.chunks.values()) {
            if (mesh.material.uniforms[name]) {
                if (typeof value === 'object' && value.set) {
                    mesh.material.uniforms[name].value.copy(value);
                } else {
                    mesh.material.uniforms[name].value = value;
                }
            }
        }
    }

    // Get water chunk meshes for raycasting
    getWaterChunks() {
        return Array.from(this.chunks.values());
    }
}

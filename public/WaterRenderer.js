// File: public/WaterRenderer.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\WaterRenderer.js

import * as THREE from 'three';
import GUI from 'lil-gui';
import { CONFIG as GAME_CONFIG } from './config.js';

// --- Simplified Water Vertex Shader (based on old version) ---
// Replace your existing waterVertexShader with this modified version:

const waterVertexShader = `
    precision mediump float;
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_wave_speed;
    uniform vec2 u_chunk_offset;
    uniform float u_chunk_size;
    uniform float u_water_level;
    uniform sampler2D u_height_texture;
    uniform float u_wave_damp_min_depth;
    uniform float u_wave_damp_max_depth;
    uniform float u_deep_water_threshold;
    uniform int u_terrain_seed;

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vWaveHeight;
    varying float vWaveSlope;
    varying float vFogDepth;

    // Perlin noise implementation for GLSL
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

    float perlinNoise(vec3 P) {
        vec3 Pi0 = floor(P);
        vec3 Pi1 = Pi0 + vec3(1.0);
        Pi0 = mod289(Pi0);
        Pi1 = mod289(Pi1);
        vec3 Pf0 = fract(P);
        vec3 Pf1 = Pf0 - vec3(1.0);
        vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        vec4 iy = vec4(Pi0.yy, Pi1.yy);
        vec4 iz0 = Pi0.zzzz;
        vec4 iz1 = Pi1.zzzz;

        vec4 ixy = permute(permute(ix) + iy);
        vec4 ixy0 = permute(ixy + iz0);
        vec4 ixy1 = permute(ixy + iz1);

        vec4 gx0 = ixy0 * (1.0 / 7.0);
        vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
        gx0 = fract(gx0);
        vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
        vec4 sz0 = step(gz0, vec4(0.0));
        gx0 -= sz0 * (step(0.0, gx0) - 0.5);
        gy0 -= sz0 * (step(0.0, gy0) - 0.5);

        vec4 gx1 = ixy1 * (1.0 / 7.0);
        vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
        gx1 = fract(gx1);
        vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
        vec4 sz1 = step(gz1, vec4(0.0));
        gx1 -= sz1 * (step(0.0, gx1) - 0.5);
        gy1 -= sz1 * (step(0.0, gy1) - 0.5);

        vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
        vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
        vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
        vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
        vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
        vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
        vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
        vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

        vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
        vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;

        float n000 = dot(g000, Pf0);
        float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
        float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
        float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
        float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
        float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
        float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
        float n111 = dot(g111, Pf1);

        vec3 fade_xyz = fade(Pf0);
        vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
        vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
        return n_xyz;
    }

    // Round coordinates for precision matching (like roundCoord in terrain.js)
    const float FLOAT_PRECISION = 1000000.0;
    float roundCoord(float coord) {
        return floor(coord * FLOAT_PRECISION + 0.5) / FLOAT_PRECISION;
    }

    // ⚠️ ============================================================================
    // ⚠️ CRITICAL SYNCHRONIZATION WARNING - TERRAIN GENERATION CODE
    // ⚠️ ============================================================================
    // ⚠️ This terrain generation algorithm is DUPLICATED in THREE locations:
    // ⚠️
    // ⚠️   1. terrain.js HeightCalculator.calculateHeight() (MAIN THREAD)
    // ⚠️   2. terrain.js worker calculateHeight() (WEB WORKER - line ~636)
    // ⚠️   3. WaterRenderer.js calculateTerrainHeight() (GPU VERTEX SHADER - line ~106)
    // ⚠️   4. WaterRenderer.js calculateTerrainHeight() (GPU FRAGMENT SHADER - line ~348)
    // ⚠️
    // ⚠️ ANY CHANGES TO THIS ALGORITHM MUST BE MANUALLY REPLICATED TO ALL LOCATIONS!
    // ⚠️
    // ⚠️ This includes: base terrain, mountains, jagged detail, terrain floor, ocean, river
    // ⚠️ ============================================================================
    float calculateTerrainHeight(vec2 worldPos) {
        // Round coordinates for precision (matches terrain.js roundCoord)
        float x = roundCoord(worldPos.x);
        float z = roundCoord(worldPos.y);

        // Base terrain
        float base = 0.0;
        float amplitude = 1.0;
        float frequency = 0.02;
        for (int octave = 0; octave < 3; octave++) {
            base += perlinNoise(vec3(x * frequency, z * frequency, 10.0 + float(octave) * 7.0)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        // Mountain mask
        float maskRaw = perlinNoise(vec3(x * 0.006, z * 0.006, 400.0));
        float mask = pow((maskRaw + 1.0) * 0.5, 3.0);

        // Mountains
        float mountain = 0.0;
        amplitude = 1.0;
        frequency = 0.04;
        for (int octave = 0; octave < 4; octave++) {
            mountain += abs(perlinNoise(vec3(x * frequency, z * frequency, 500.0 + float(octave) * 11.0))) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        mountain *= 40.0 * mask;

        float heightBeforeJagged = base + mountain;

        // Jagged detail
        float elevNorm = clamp((heightBeforeJagged + 2.0) / 25.0, 0.0, 1.0);
        float jaggedScale = heightBeforeJagged < 1.5 ? max(0.1, (heightBeforeJagged + 0.5) / 10.0) : 1.0;
        float jagged = perlinNoise(vec3(x * 0.8, z * 0.8, 900.0)) * 1.2 * elevNorm * jaggedScale +
                      perlinNoise(vec3(x * 1.6, z * 1.6, 901.0)) * 0.6 * elevNorm * jaggedScale;

        float height = heightBeforeJagged + jagged;

        // ========== TERRAIN REFLECTION (PREVENTS WATER PUDDLES) ==========
        // Simple reflection: values below 1.3 get mirrored above it
        // This preserves all terrain variation while eliminating low spots
        // Examples: 1.2 becomes 1.4, 1.0 becomes 1.6, 0 becomes 2.6
        if (height < 1.3) {
            height = 1.3 + (1.3 - height);
        }
        // ========== TERRAIN REFLECTION END ==========

        // ========== OCEAN GENERATION START (DELETE FROM HERE TO REMOVE OCEAN) ==========
        // Create ocean by lowering terrain smoothly and randomly
        // Coastline position varies between x=0 and x=20 based on z position
        float coastlineThreshold = 10.0 + perlinNoise(vec3(z * 0.01, 777.0, 0.0)) * 10.0;
        float transitionWidth = 8.0; // Units over which to blend from land to ocean

        // Calculate distance from threshold (positive = ocean side, negative = land side)
        float distanceFromThreshold = x - coastlineThreshold;

        // Create smooth transition using smoothstep function
        // t goes from 0 (before transition) to 1 (after transition)
        float t = clamp((distanceFromThreshold + transitionWidth) / (transitionWidth * 2.0), 0.0, 1.0);
        float smoothTransition = t * t * (3.0 - 2.0 * t); // Smoothstep S-curve

        if (smoothTransition > 0.0) {
            float oceanDistance = max(0.0, distanceFromThreshold);

            // Reduce noise intensity as distance from coast increases (smoother deep ocean)
            float noiseIntensity = 1.0 / (1.0 + oceanDistance * 0.05);

            // Add noise for varied coastline - intensity reduces with distance
            float coastlineNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 999.0)) * 5.0 * noiseIntensity;
            float adjustedDistance = max(0.0, oceanDistance + coastlineNoise);

            // Gradually deepen as distance increases - depth noise also reduces with distance
            float depthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 888.0)) * 2.0 * noiseIntensity;
            float depthFactor = (adjustedDistance * 0.5) + depthNoise;

            // Apply ocean effect gradually based on transition
            height -= depthFactor * smoothTransition;

            // Cap at ocean floor
            height = max(height, -3.0);
        }
        // ========== OCEAN GENERATION END (DELETE TO HERE TO REMOVE OCEAN) ==========

        // ========== RIVER GENERATION START (DELETE FROM HERE TO REMOVE RIVER) ==========
        // Create rivers at random intervals along the Z-axis (every 100-300 units)
        // Rivers run parallel to the coast, perpendicular to ocean

        float riverSegmentSize = 200.0; // Average spacing between rivers
        float riverTransitionWidth = 8.0; // Units over which to blend
        float riverWidth = 10.0; // Distance from first bank to center (and center to far bank)

        // Determine which river segment we're in
        float riverSegment = floor(z / riverSegmentSize);

        // Use segment number to generate deterministic random values for this segment
        float segmentSeed = riverSegment * 73856093.0; // Large prime for good distribution
        float segmentRandom = abs(sin(segmentSeed) * 43758.5453123);
        float hasRiver = mod(segmentRandom, 1.0) > 0.3 ? 1.0 : 0.0; // 70% chance of river in this segment

        if (hasRiver > 0.5) {
            // Random offset within segment (0-100 range gives 100-300 spacing variability)
            float riverOffsetInSegment = mod(segmentRandom * 7919.0, 1.0) * 100.0; // Use different multiplier for offset
            float riverCenterZ = riverSegment * riverSegmentSize + riverOffsetInSegment + 10.0;

            // River meanders based on x position
            float riverMeanderOffset = perlinNoise(vec3(x * 0.01, 666.0 + riverSegment, 0.0)) * 10.0;
            float riverThreshold = riverCenterZ + riverMeanderOffset;

            // Calculate distance from river threshold
            float riverDistanceFromThreshold = z - riverThreshold;

            // River occupies z = threshold to threshold + 20 (two 10-unit banks)
            if (riverDistanceFromThreshold >= -riverTransitionWidth && riverDistanceFromThreshold <= riverWidth * 2.0 + riverTransitionWidth) {
                float riverDepthFactor = 0.0;

                if (riverDistanceFromThreshold <= riverWidth) {
                    // First bank (z = threshold to threshold + 10)
                    float t = clamp((riverDistanceFromThreshold + riverTransitionWidth) / (riverTransitionWidth * 2.0), 0.0, 1.0);
                    float smoothTransition = t * t * (3.0 - 2.0 * t);

                    if (smoothTransition > 0.0) {
                        float riverDistance = max(0.0, riverDistanceFromThreshold);
                        float noiseIntensity = 1.0 / (1.0 + riverDistance * 0.05);
                        float riverBankNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 555.0)) * 5.0 * noiseIntensity;
                        float adjustedRiverDistance = max(0.0, riverDistance + riverBankNoise);
                        float riverDepthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 444.0)) * 2.0 * noiseIntensity;
                        riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                    }
                } else {
                    // Second bank (z = threshold + 10 to threshold + 20)
                    float reversedDistance = riverWidth * 2.0 - riverDistanceFromThreshold;
                    float t = clamp((reversedDistance + riverTransitionWidth) / (riverTransitionWidth * 2.0), 0.0, 1.0);
                    float smoothTransition = t * t * (3.0 - 2.0 * t);

                    if (smoothTransition > 0.0) {
                        float riverDistance = max(0.0, reversedDistance);
                        float noiseIntensity = 1.0 / (1.0 + riverDistance * 0.05);
                        float riverBankNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 555.0)) * 5.0 * noiseIntensity;
                        float adjustedRiverDistance = max(0.0, riverDistance + riverBankNoise);
                        float riverDepthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 444.0)) * 2.0 * noiseIntensity;
                        riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                    }
                }

                // Apply river effect
                height -= riverDepthFactor;
                height = max(height, -3.0);
            }
        }
        // ========== RIVER GENERATION END (DELETE TO HERE TO REMOVE RIVER) ==========

        return height;
    }

    float sampleTerrainHeight(vec2 worldPos) {
        // Convert world position to texture coordinates
        vec2 texCoord = (worldPos - u_chunk_offset) / u_chunk_size + 0.5;

        // Sample the height texture
        float normalizedHeight = texture2D(u_height_texture, texCoord).r;

        // Convert from normalized [0,1] back to world height range
        float minHeight = -10.0;
        float maxHeight = 80.0;
        return normalizedHeight * (maxHeight - minHeight) + minHeight;
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

        // Get world position for this vertex (before wave displacement)
        // The plane is 50x50 units centered at origin, so pos ranges from -25 to +25
        // modelMatrix applies the chunk position (from mesh.position.set)
        vec4 worldPosVec4 = modelMatrix * vec4(pos, 1.0);
        vec2 worldXZ = worldPosVec4.xz;

        // Calculate water depth at this position
        float terrainHeight = sampleTerrainHeight(worldXZ);
        float waterDepth = u_water_level - terrainHeight;

        // No wave dampening - full waves at all depths
        float depthFactor = 1.0;

        // Simplified 3-wave system (from old version)
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldXZ, u_wave_frequency, 1.5) * 0.5;
        waveDisplacement += wave(worldXZ * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        waveDisplacement += wave(worldXZ * 2.3, u_wave_frequency * 0.9, 1.8) * 0.2;

        // Apply depth-based damping to wave displacement
        pos.y += waveDisplacement * u_wave_height * depthFactor;
        vWaveHeight = waveDisplacement * depthFactor;

        // Calculate wave slopes for foam and normal calculations (also dampened)
        float slopeX = 0.0;
        float slopeZ = 0.0;
        slopeX += waveDerivativeX(worldXZ, u_wave_frequency, 1.5) * 0.5;
        slopeX += waveDerivativeX(worldXZ * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        slopeZ += waveDerivativeZ(worldXZ, u_wave_frequency, 1.5) * 0.5;
        slopeZ += waveDerivativeZ(worldXZ * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        vWaveSlope = length(vec2(slopeX, slopeZ)) * u_wave_height * depthFactor;

        // Transform to final world space with wave displacement applied
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        // Calculate normal from wave slopes (also dampened)
        vec3 tangentX = vec3(1.0, slopeX * u_wave_height * depthFactor, 0.0);
        vec3 tangentZ = vec3(0.0, slopeZ * u_wave_height * depthFactor, 1.0);
        vWorldNormal = normalize(cross(tangentX, tangentZ));

        vec4 mvPosition = viewMatrix * worldPosition;
        vFogDepth = -mvPosition.z;

        gl_Position = projectionMatrix * mvPosition;
    }
`;

// --- Simplified Water Fragment Shader (based on old version) ---
const waterFragmentShader = `
    precision mediump float;

    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_normal_texture;
    uniform sampler2D u_sky_reflection_texture;
    uniform sampler2D u_foam_texture;
    uniform sampler2D u_caustics_texture;
    uniform sampler2D u_height_texture;
    uniform float u_water_level;
    uniform float u_chunk_size;
    uniform vec2 u_chunk_offset;
    uniform vec2 u_reference_position;
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
    uniform float u_wave_damp_min_depth;
    uniform float u_wave_damp_max_depth;
    uniform float u_foam_min_depth;
    uniform float u_foam_max_depth;
    uniform float u_foam_wave_influence;
    uniform int u_terrain_seed;

    // Foam texture controls
    uniform bool u_foam_use_texture;
    uniform float u_foam_texture_scale;
    uniform float u_foam_texture_speed;
    uniform float u_foam_texture_intensity;
    uniform float u_foam_texture_rotation;
    uniform vec2 u_foam_texture_offset;
    uniform vec3 fogColor;
    uniform float fogDensity;

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vWaveHeight;
    varying float vWaveSlope;
    varying float vFogDepth;

    // Perlin noise implementation (same as vertex shader)
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

    float perlinNoise(vec3 P) {
        vec3 Pi0 = floor(P);
        vec3 Pi1 = Pi0 + vec3(1.0);
        Pi0 = mod289(Pi0);
        Pi1 = mod289(Pi1);
        vec3 Pf0 = fract(P);
        vec3 Pf1 = Pf0 - vec3(1.0);
        vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        vec4 iy = vec4(Pi0.yy, Pi1.yy);
        vec4 iz0 = Pi0.zzzz;
        vec4 iz1 = Pi1.zzzz;

        vec4 ixy = permute(permute(ix) + iy);
        vec4 ixy0 = permute(ixy + iz0);
        vec4 ixy1 = permute(ixy + iz1);

        vec4 gx0 = ixy0 * (1.0 / 7.0);
        vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
        gx0 = fract(gx0);
        vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
        vec4 sz0 = step(gz0, vec4(0.0));
        gx0 -= sz0 * (step(0.0, gx0) - 0.5);
        gy0 -= sz0 * (step(0.0, gy0) - 0.5);

        vec4 gx1 = ixy1 * (1.0 / 7.0);
        vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
        gx1 = fract(gx1);
        vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
        vec4 sz1 = step(gz1, vec4(0.0));
        gx1 -= sz1 * (step(0.0, gx1) - 0.5);
        gy1 -= sz1 * (step(0.0, gy1) - 0.5);

        vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
        vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
        vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
        vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
        vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
        vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
        vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
        vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

        vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
        vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;

        float n000 = dot(g000, Pf0);
        float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
        float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
        float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
        float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
        float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
        float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
        float n111 = dot(g111, Pf1);

        vec3 fade_xyz = fade(Pf0);
        vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
        vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
        return n_xyz;
    }

    // Round coordinates for precision matching (like roundCoord in terrain.js)
    const float FLOAT_PRECISION = 1000000.0;
    float roundCoord(float coord) {
        return floor(coord * FLOAT_PRECISION + 0.5) / FLOAT_PRECISION;
    }

    // ⚠️ ============================================================================
    // ⚠️ CRITICAL SYNCHRONIZATION WARNING - TERRAIN GENERATION CODE
    // ⚠️ ============================================================================
    // ⚠️ This terrain generation algorithm is DUPLICATED in THREE locations:
    // ⚠️
    // ⚠️   1. terrain.js HeightCalculator.calculateHeight() (MAIN THREAD)
    // ⚠️   2. terrain.js worker calculateHeight() (WEB WORKER - line ~636)
    // ⚠️   3. WaterRenderer.js calculateTerrainHeight() (GPU VERTEX SHADER - line ~106)
    // ⚠️   4. WaterRenderer.js calculateTerrainHeight() (GPU FRAGMENT SHADER - line ~348)
    // ⚠️
    // ⚠️ ANY CHANGES TO THIS ALGORITHM MUST BE MANUALLY REPLICATED TO ALL LOCATIONS!
    // ⚠️
    // ⚠️ This includes: base terrain, mountains, jagged detail, terrain floor, ocean, river
    // ⚠️ ============================================================================
    float calculateTerrainHeight(vec2 worldPos) {
        // Round coordinates for precision (matches terrain.js roundCoord)
        float x = roundCoord(worldPos.x);
        float z = roundCoord(worldPos.y);

        // Base terrain
        float base = 0.0;
        float amplitude = 1.0;
        float frequency = 0.02;
        for (int octave = 0; octave < 3; octave++) {
            base += perlinNoise(vec3(x * frequency, z * frequency, 10.0 + float(octave) * 7.0)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        // Mountain mask
        float maskRaw = perlinNoise(vec3(x * 0.006, z * 0.006, 400.0));
        float mask = pow((maskRaw + 1.0) * 0.5, 3.0);

        // Mountains
        float mountain = 0.0;
        amplitude = 1.0;
        frequency = 0.04;
        for (int octave = 0; octave < 4; octave++) {
            mountain += abs(perlinNoise(vec3(x * frequency, z * frequency, 500.0 + float(octave) * 11.0))) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        mountain *= 40.0 * mask;

        float heightBeforeJagged = base + mountain;

        // Jagged detail
        float elevNorm = clamp((heightBeforeJagged + 2.0) / 25.0, 0.0, 1.0);
        float jaggedScale = heightBeforeJagged < 1.5 ? max(0.1, (heightBeforeJagged + 0.5) / 10.0) : 1.0;
        float jagged = perlinNoise(vec3(x * 0.8, z * 0.8, 900.0)) * 1.2 * elevNorm * jaggedScale +
                      perlinNoise(vec3(x * 1.6, z * 1.6, 901.0)) * 0.6 * elevNorm * jaggedScale;

        float height = heightBeforeJagged + jagged;

        // ========== TERRAIN REFLECTION (PREVENTS WATER PUDDLES) ==========
        // Simple reflection: values below 1.3 get mirrored above it
        // This preserves all terrain variation while eliminating low spots
        // Examples: 1.2 becomes 1.4, 1.0 becomes 1.6, 0 becomes 2.6
        if (height < 1.3) {
            height = 1.3 + (1.3 - height);
        }
        // ========== TERRAIN REFLECTION END ==========

        // ========== OCEAN GENERATION START (DELETE FROM HERE TO REMOVE OCEAN) ==========
        // Create ocean by lowering terrain smoothly and randomly
        // Coastline position varies between x=0 and x=20 based on z position
        float coastlineThreshold = 10.0 + perlinNoise(vec3(z * 0.01, 777.0, 0.0)) * 10.0;
        float transitionWidth = 8.0; // Units over which to blend from land to ocean

        // Calculate distance from threshold (positive = ocean side, negative = land side)
        float distanceFromThreshold = x - coastlineThreshold;

        // Create smooth transition using smoothstep function
        // t goes from 0 (before transition) to 1 (after transition)
        float t = clamp((distanceFromThreshold + transitionWidth) / (transitionWidth * 2.0), 0.0, 1.0);
        float smoothTransition = t * t * (3.0 - 2.0 * t); // Smoothstep S-curve

        if (smoothTransition > 0.0) {
            float oceanDistance = max(0.0, distanceFromThreshold);

            // Reduce noise intensity as distance from coast increases (smoother deep ocean)
            float noiseIntensity = 1.0 / (1.0 + oceanDistance * 0.05);

            // Add noise for varied coastline - intensity reduces with distance
            float coastlineNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 999.0)) * 5.0 * noiseIntensity;
            float adjustedDistance = max(0.0, oceanDistance + coastlineNoise);

            // Gradually deepen as distance increases - depth noise also reduces with distance
            float depthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 888.0)) * 2.0 * noiseIntensity;
            float depthFactor = (adjustedDistance * 0.5) + depthNoise;

            // Apply ocean effect gradually based on transition
            height -= depthFactor * smoothTransition;

            // Cap at ocean floor
            height = max(height, -3.0);
        }
        // ========== OCEAN GENERATION END (DELETE TO HERE TO REMOVE OCEAN) ==========

        // ========== RIVER GENERATION START (DELETE FROM HERE TO REMOVE RIVER) ==========
        // Create rivers at random intervals along the Z-axis (every 100-300 units)
        // Rivers run parallel to the coast, perpendicular to ocean

        float riverSegmentSize = 200.0; // Average spacing between rivers
        float riverTransitionWidth = 8.0; // Units over which to blend
        float riverWidth = 10.0; // Distance from first bank to center (and center to far bank)

        // Determine which river segment we're in
        float riverSegment = floor(z / riverSegmentSize);

        // Use segment number to generate deterministic random values for this segment
        float segmentSeed = riverSegment * 73856093.0; // Large prime for good distribution
        float segmentRandom = abs(sin(segmentSeed) * 43758.5453123);
        float hasRiver = mod(segmentRandom, 1.0) > 0.3 ? 1.0 : 0.0; // 70% chance of river in this segment

        if (hasRiver > 0.5) {
            // Random offset within segment (0-100 range gives 100-300 spacing variability)
            float riverOffsetInSegment = mod(segmentRandom * 7919.0, 1.0) * 100.0; // Use different multiplier for offset
            float riverCenterZ = riverSegment * riverSegmentSize + riverOffsetInSegment + 10.0;

            // River meanders based on x position
            float riverMeanderOffset = perlinNoise(vec3(x * 0.01, 666.0 + riverSegment, 0.0)) * 10.0;
            float riverThreshold = riverCenterZ + riverMeanderOffset;

            // Calculate distance from river threshold
            float riverDistanceFromThreshold = z - riverThreshold;

            // River occupies z = threshold to threshold + 20 (two 10-unit banks)
            if (riverDistanceFromThreshold >= -riverTransitionWidth && riverDistanceFromThreshold <= riverWidth * 2.0 + riverTransitionWidth) {
                float riverDepthFactor = 0.0;

                if (riverDistanceFromThreshold <= riverWidth) {
                    // First bank (z = threshold to threshold + 10)
                    float t = clamp((riverDistanceFromThreshold + riverTransitionWidth) / (riverTransitionWidth * 2.0), 0.0, 1.0);
                    float smoothTransition = t * t * (3.0 - 2.0 * t);

                    if (smoothTransition > 0.0) {
                        float riverDistance = max(0.0, riverDistanceFromThreshold);
                        float noiseIntensity = 1.0 / (1.0 + riverDistance * 0.05);
                        float riverBankNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 555.0)) * 5.0 * noiseIntensity;
                        float adjustedRiverDistance = max(0.0, riverDistance + riverBankNoise);
                        float riverDepthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 444.0)) * 2.0 * noiseIntensity;
                        riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                    }
                } else {
                    // Second bank (z = threshold + 10 to threshold + 20)
                    float reversedDistance = riverWidth * 2.0 - riverDistanceFromThreshold;
                    float t = clamp((reversedDistance + riverTransitionWidth) / (riverTransitionWidth * 2.0), 0.0, 1.0);
                    float smoothTransition = t * t * (3.0 - 2.0 * t);

                    if (smoothTransition > 0.0) {
                        float riverDistance = max(0.0, reversedDistance);
                        float noiseIntensity = 1.0 / (1.0 + riverDistance * 0.05);
                        float riverBankNoise = perlinNoise(vec3(x * 0.02, z * 0.02, 555.0)) * 5.0 * noiseIntensity;
                        float adjustedRiverDistance = max(0.0, riverDistance + riverBankNoise);
                        float riverDepthNoise = perlinNoise(vec3(x * 0.05, z * 0.05, 444.0)) * 2.0 * noiseIntensity;
                        riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                    }
                }

                // Apply river effect
                height -= riverDepthFactor;
                height = max(height, -3.0);
            }
        }
        // ========== RIVER GENERATION END (DELETE TO HERE TO REMOVE RIVER) ==========

        return height;
    }

    float sampleTerrainHeight(vec2 worldPos) {
        // Convert world position to texture coordinates
        vec2 texCoord = (worldPos - u_chunk_offset) / u_chunk_size + 0.5;

        // Sample the height texture
        float normalizedHeight = texture2D(u_height_texture, texCoord).r;

        // Convert from normalized [0,1] back to world height range
        float minHeight = -10.0;
        float maxHeight = 80.0;
        return normalizedHeight * (maxHeight - minHeight) + minHeight;
    }

    void main() {
        // Sample terrain height and calculate depth
        float terrainHeight = sampleTerrainHeight(vWorldPosition.xz);

        // Calculate water depth using actual wave-displaced surface height
        // vWorldPosition.y contains the wave-displaced water surface height
        float waterDepth = vWorldPosition.y - terrainHeight;

        // Discard fragments where terrain is above water level
        if (waterDepth < 0.0) discard;

        // Use waterDepth for all depth-based calculations
        float local_depth = waterDepth;

        // === DEPTH ZONES ===
        // Shallow: 0-1.0 units (keep detailed normals and foam)
        // Deep: 1.0+ units (reduce tiling, add organic variation)
        float shallowFactor = 1.0 - smoothstep(0.8, 1.5, local_depth);

        // Simplified normal mapping (from old version approach)
        vec2 worldUV = vWorldPosition.xz * 0.02; // Scale world coordinates

        // Rotate UVs based on distance from reference point (subtle curve: 40 degrees per 100 units)
        float distFromRef = length(vWorldPosition.xz - u_reference_position);
        float rotAngle = distFromRef * 0.00698132; // 40 degrees per 100 units in radians
        float cosA = cos(rotAngle);
        float sinA = sin(rotAngle);
        mat2 rotMatrix = mat2(cosA, -sinA, sinA, cosA);
        worldUV = rotMatrix * worldUV;

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

        // Reduce normal map influence in deep water to eliminate tiling
        float normalStrength = u_normal_scale * 0.3 * shallowFactor;
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, normalStrength));
        
        // Simplified depth zones
        // 0 - 3.0   : shallow to deep (0.0 to 1.0 opacity)
        // > 3.0     : full opacity
        float depthFactor = clamp(local_depth / 3.0, 0.0, 1.0);

        // Base color with clean depth-based mixing
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, depthFactor);

        // === DEEP WATER ORGANIC COLOR VARIATION ===
        // Add large-scale Perlin noise for natural color variation (like ocean.png)
        if (local_depth > 0.8) {
            // Very large scale noise for organic patches
            float colorNoise1 = perlinNoise(vec3(vWorldPosition.x * 0.008, vWorldPosition.z * 0.008, u_time * 0.05));
            float colorNoise2 = perlinNoise(vec3(vWorldPosition.x * 0.015, vWorldPosition.z * 0.015, u_time * 0.03 + 100.0));
            float colorNoise3 = perlinNoise(vec3(vWorldPosition.x * 0.025, vWorldPosition.z * 0.025, u_time * 0.02 + 200.0));

            // Combine noise layers for rich variation
            float combinedNoise = colorNoise1 * 0.5 + colorNoise2 * 0.3 + colorNoise3 * 0.2;

            // Apply subtle color variation (darker/lighter patches)
            float deepFactor = smoothstep(0.8, 2.0, local_depth);
            waterBaseColor *= (1.0 + combinedNoise * 0.15 * deepFactor);
        }

        // Simple transparency: 0 at shore, 0.8 at depth 3.0+
        float alpha = clamp(local_depth / 3.0, 0.0, 0.8);

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

        // === SUN SPARKLES ON WAVE PEAKS (like ocean.png highlights) ===
        float sparkles = 0.0;
        if (local_depth > 1.0) {
            // Detect wave peaks using wave height and slope
            float peakFactor = smoothstep(0.005, 0.02, vWaveSlope);

            // Add high-frequency noise for scattered sparkle effect
            float sparkleNoise1 = perlinNoise(vec3(vWorldPosition.x * 0.6, vWorldPosition.z * 0.6, u_time * 0.25));
            float sparkleNoise2 = perlinNoise(vec3(vWorldPosition.x * 1.2, vWorldPosition.z * 1.2, u_time * 0.15 + 300.0));

            // Threshold to create bright spots - lowered thresholds for more visibility
            float sparklePattern = smoothstep(0.5, 0.75, sparkleNoise1) * smoothstep(0.45, 0.7, sparkleNoise2);

            // Less view-dependent for fixed camera (just use a base level)
            // Still slightly angle-aware but much more permissive
            float viewDotSun = max(0.0, dot(viewDir, u_sun_direction));
            float viewFactor = mix(0.6, 1.0, pow(viewDotSun, 1.0)); // Base 60% visibility

            // Combine factors
            sparkles = sparklePattern * peakFactor * viewFactor;

            // Temporal shimmer
            float shimmer = sin(u_time * 3.0 + sparkleNoise1 * 12.56) * 0.5 + 0.5;
            sparkles *= shimmer * 0.6 + 0.4;

            // Fade with depth
            sparkles *= smoothstep(1.0, 1.5, local_depth) * (1.0 - smoothstep(6.0, 12.0, local_depth));
        }

        // Add sparkles to specular - boosted intensity
        specularColor += u_sun_color * sparkles * 2.5;
        
        // Foam calculation - depth-based with adjustable wave influence and TEXTURE
        float foam = 0.0;
        if (u_enable_foam) {
            // Create foam band that peaks in the middle and fades to transparent on both ends
            float foamMidpoint = (u_foam_min_depth + u_foam_max_depth) / 2.0;
            float foamRange = u_foam_max_depth - u_foam_min_depth;
            float fadeWidth = foamRange * 0.4; // 40% of range on each side for smooth fades

            // Fade IN from shore side (transparent at shore, full at midpoint)
            float fadeIn = smoothstep(u_foam_min_depth, foamMidpoint, local_depth);

            // Fade OUT on ocean side (full at midpoint, transparent at deep water)
            float fadeOut = 1.0 - smoothstep(foamMidpoint, u_foam_max_depth, local_depth);

            // Combine both fades to create peaked band
            float depthFoamFactor = fadeIn * fadeOut;

            // Wave slope influence (adjustable via GUI)
            float waveFoamFactor = smoothstep(0.001, 0.02, vWaveSlope);

            // Combine depth and wave influences
            foam = depthFoamFactor * mix(1.0, waveFoamFactor, u_foam_wave_influence);

            // Enhanced wave-based foam pulsing (breathing effect)
            float foamPulse1 = sin(local_depth * 30.0 + u_time * 2.5) * 0.5 + 0.5;
            float foamPulse2 = sin(local_depth * 45.0 + u_time * 1.8 + vWorldPosition.x * 0.1) * 0.5 + 0.5;
            float combinedPulse = foamPulse1 * 0.6 + foamPulse2 * 0.4;

            // Stronger pulsing effect - foam fades in and out more dramatically
            foam *= combinedPulse * 0.5 + 0.5; // Range from 0.5 to 1.0 intensity

            // Animate foam zone boundaries (breathing effect)
            float zoneAnimation = sin(u_time * 1.2) * 0.1 + cos(u_time * 0.8) * 0.05;
            float animatedMaxDepth = u_foam_max_depth + zoneAnimation;

            // Recalculate depth factor with animated boundary
            float animatedFadeOut = 1.0 - smoothstep(foamMidpoint, animatedMaxDepth, local_depth);
            foam *= animatedFadeOut;

            // === SHORE INTERACTION FOAM ===
            // Add special foam effects very close to shore
            if (local_depth < 0.4) {
                // Use smoother shore proximity with wider transition
                float shoreProximity = 1.0 - smoothstep(0.0, 0.4, local_depth);

                // Add noise to break up hard edges
                float edgeNoise = perlinNoise(vec3(vWorldPosition.x * 0.5, vWorldPosition.z * 0.5, u_time * 0.3));
                float softEdge = shoreProximity * (0.8 + edgeNoise * 0.4);

                // CURVED WAVE FRONTS
                // Create radial waves that curve naturally
                float waveOriginX = sin(u_time * 0.3) * 20.0; // Moving wave origin
                float waveOriginZ = cos(u_time * 0.25) * 15.0;

                // Distance from wave origin creates curved fronts
                float distFromOrigin = length(vec2(vWorldPosition.x - waveOriginX, vWorldPosition.z - waveOriginZ));

                // Multiple curved wave patterns
                float curvedWave1 = sin(distFromOrigin * 0.15 - u_time * 2.0) * 0.5 + 0.5;
                float curvedWave2 = sin(distFromOrigin * 0.1 - u_time * 1.5 + 3.14) * 0.5 + 0.5;

                // Combine curved waves with shore proximity
                float waveRunUp = softEdge * (curvedWave1 * 0.6 + curvedWave2 * 0.4);

                // Smoother foam line using modified depth with noise
                float depthWithNoise = local_depth + edgeNoise * 0.05;
                float smoothFoamLine = exp(-depthWithNoise * 12.0) * 0.4;

                // Organic foam patches using noise
                float foamPatches = 0.0;
                if (shoreProximity > 0.3) {
                    float patchNoise1 = perlinNoise(vec3(vWorldPosition.x * 0.3, vWorldPosition.z * 0.3, u_time * 0.5));
                    float patchNoise2 = perlinNoise(vec3(vWorldPosition.x * 0.7, vWorldPosition.z * 0.6, u_time * 0.7));
                    foamPatches = max(0.0, patchNoise1 * 0.5 + patchNoise2 * 0.5) * softEdge * 0.4;
                }

                // Directional foam flow (simulating water running back to sea)
                float flowDirection = sin(vWorldPosition.x * 0.5 - u_time * 3.0) *
                                     cos(vWorldPosition.z * 0.3 - u_time * 2.0);
                float flowFoam = max(0.0, flowDirection) * softEdge * 0.3;

                // Combine all shore effects with smooth blending
                float shoreFoam = (waveRunUp * 0.5 + smoothFoamLine + foamPatches + flowFoam) * 0.8;

                // Add to base foam
                foam = foam + shoreFoam;
            }

            foam *= 1.5; // Moderate boost
            foam = clamp(foam, 0.0, 1.0);
        }

        // === DEEP WATER SCATTERED FOAM PATCHES (like ocean.png white caps) ===
        float deepWaterFoam = 0.0;
        if (local_depth > 1.0) {
            // Use wave slope to detect wave crests - lowered threshold for more visibility
            float waveCrestFactor = smoothstep(0.003, 0.015, vWaveSlope);

            // Large-scale noise for scattered foam patches
            float foamNoise1 = perlinNoise(vec3(vWorldPosition.x * 0.12, vWorldPosition.z * 0.12, u_time * 0.15));
            float foamNoise2 = perlinNoise(vec3(vWorldPosition.x * 0.25, vWorldPosition.z * 0.25, u_time * 0.1 + 50.0));
            float foamNoise3 = perlinNoise(vec3(vWorldPosition.x * 0.08, vWorldPosition.z * 0.08, u_time * 0.12 + 150.0));

            // Lower thresholds to create more visible patches
            float foamPatch = smoothstep(0.35, 0.65, foamNoise1) * smoothstep(0.3, 0.6, foamNoise2);

            // Add larger patches for variety
            float largePatch = smoothstep(0.4, 0.7, foamNoise3);
            foamPatch = max(foamPatch, largePatch * 0.7);

            // Combine with wave crests
            deepWaterFoam = foamPatch * waveCrestFactor;

            // Add temporal variation (breathing effect) - but keep base level
            float foamPulse = sin(u_time * 1.5 + foamNoise1 * 6.28) * 0.5 + 0.5;
            deepWaterFoam *= foamPulse * 0.4 + 0.6; // More consistent visibility

            // Fade based on depth (more foam visible in medium-deep water)
            float deepFoamFactor = smoothstep(1.0, 1.5, local_depth) * (1.0 - smoothstep(5.0, 10.0, local_depth));
            deepWaterFoam *= deepFoamFactor;

            // Boost intensity significantly
            deepWaterFoam *= 2.0;

            // Add to existing foam
            foam = max(foam, deepWaterFoam);
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
        if (u_enable_foam && foam > 0.0) {
            vec3 foamColorFinal = vec3(1.0, 1.0, 1.0);  // Default white foam

            // Apply foam texture if enabled
            if (u_foam_use_texture) {
                // === MULTI-LAYER FOAM TEXTURING ===
                // Layer 1: Base foam (current scale - the largest patches)
                vec2 foamUV1 = vWorldPosition.xz * u_foam_texture_scale;

                // Layer 2: Medium detail (2.5x smaller than base)
                vec2 foamUV2 = vWorldPosition.xz * (u_foam_texture_scale * 2.5);

                // Layer 3: Fine detail (5x smaller than base)
                vec2 foamUV3 = vWorldPosition.xz * (u_foam_texture_scale * 5.0);

                // Apply rotation to all layers if needed
                if (abs(u_foam_texture_rotation) > 0.001) {
                    float angle = u_foam_texture_rotation;
                    float cosA = cos(angle);
                    float sinA = sin(angle);
                    mat2 rotMatrix = mat2(cosA, -sinA, sinA, cosA);
                    foamUV1 = rotMatrix * foamUV1;
                    foamUV2 = rotMatrix * foamUV2;
                    foamUV3 = rotMatrix * foamUV3;
                }

                // Animate each layer at slightly different speeds for variety
                float baseSpeed = u_foam_texture_speed * 0.01;
                foamUV1 += vec2(u_time * baseSpeed, u_time * baseSpeed * 0.7);
                foamUV2 += vec2(u_time * baseSpeed * 1.3, u_time * baseSpeed * 0.9);
                foamUV3 += vec2(u_time * baseSpeed * 0.7, u_time * baseSpeed * 1.2);

                // Apply user offset to base layer
                foamUV1 += u_foam_texture_offset;
                foamUV2 += u_foam_texture_offset * 0.7;  // Slightly different offset for variety
                foamUV3 += u_foam_texture_offset * 0.4;

                // Sample all three layers
                vec4 foamLayer1 = texture2D(u_foam_texture, foamUV1);
                vec4 foamLayer2 = texture2D(u_foam_texture, foamUV2);
                vec4 foamLayer3 = texture2D(u_foam_texture, foamUV3);

                // Check if texture is valid (not pink/magenta fallback)
                bool isValidTexture = !(foamLayer1.r > 0.9 && foamLayer1.g < 0.1 && foamLayer1.b > 0.9);

                if (isValidTexture) {
                    // Combine layers with depth-based weighting
                    // Near shore: all layers visible
                    // Further out: only larger layers visible
                    float depthFade = smoothstep(0.0, 0.5, local_depth);

                    // Layer weights now sum to 1.0 or higher for full intensity
                    float layer1Weight = 0.6;  // Base layer dominant
                    float layer2Weight = mix(0.3, 0.15, depthFade);  // Medium detail
                    float layer3Weight = mix(0.25, 0.0, depthFade);  // Fine detail only near shore

                    // Normalize weights to ensure consistent brightness
                    float totalWeight = layer1Weight + layer2Weight + layer3Weight;

                    // Combine the layers
                    float foamTexIntensity = (foamLayer1.r * layer1Weight +
                                             foamLayer2.r * layer2Weight +
                                             foamLayer3.r * layer3Weight) / totalWeight;

                    // Apply intensity control
                    foamTexIntensity = clamp(foamTexIntensity * u_foam_texture_intensity, 0.0, 2.0);

                    // Modulate foam mask with texture
                    foam *= foamTexIntensity;
                    foam = clamp(foam, 0.0, 1.0);

                    // Keep foam pure white - use brightest sample
                    foamColorFinal = vec3(1.0, 1.0, 1.0);  // Force pure white foam
                }
            }

            // Blend foam with water
            finalColor = mix(finalColor, foamColorFinal, foam);
            alpha = mix(alpha, 1.0, foam); // Fully opaque foam
        }

        // Apply exponential fog
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        finalColor = mix(finalColor, fogColor, fogFactor);

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- Main Hybrid WaterRenderer Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = GAME_CONFIG.WATER.LEVEL, terrainRenderer = null, sceneManager = null) {
        this.scene = scene || this.createTestScene();
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer;
        this.sceneManager = sceneManager;
        this.waterChunks = new Map();
        this.sharedMaterial = null;
        this.uniforms = {};
        this.heightTextures = new Map();
        this.gui = null;

        // Skybox GUI control tracking
        this.skyboxYOffset = 14;
        
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

            // Apply proper texture properties with anisotropic filtering
            this.setupTextureProperties(newFoamTexture, true);

            this.foamTexture = newFoamTexture;

            // Update material with new texture
            if (this.uniforms.u_foam_texture) {
                this.uniforms.u_foam_texture.value = this.foamTexture;
                this.updateMaterials();
            }
        } catch (e) {
            console.error('❌ Failed to load foam texture:', e);
            console.warn('Using fallback foam texture');
        }
        
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
    // Set texture properties - always apply to ensure correct wrapping
    if (repeat) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
    } else {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.needsUpdate = true;
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
        const shallowColor = new THREE.Color(0x5fc1e8); // Light blue shallow water
        const deepColor = new THREE.Color(0x004a99);    // Dark blue deep water
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
            u_reference_position: { value: new THREE.Vector2(0, 0) },
            
            // GUI parameters (old version defaults)
            u_shininess: { value: 1.0 },
            u_foam_threshold: { value: 5.0 },
            u_normal_scale: { value: 0.0 },
            u_texture_scale: { value: 0.6 },
            u_transparency: { value: 1.0 },
            u_caustics_intensity: { value: 0.13 },
            u_enable_caustics: { value: true },
            u_enable_foam: { value: true },
            u_enable_reflections: { value: true },

            // Wave damping controls
            u_wave_damp_min_depth: { value: 0.05 },
            u_wave_damp_max_depth: { value: 0.1 },
            u_deep_water_threshold: { value: 0.7 },

            // Foam controls
            u_foam_min_depth: { value: 0.0 },
            u_foam_max_depth: { value: 0.779 },
            u_foam_wave_influence: { value: 0.631 },

            // Foam texture controls
            u_foam_use_texture: { value: true },
            u_foam_texture_scale: { value: 0.644355 },
            u_foam_texture_speed: { value: 5.0 },
            u_foam_texture_intensity: { value: 1.13 },
            u_foam_texture_rotation: { value: 0.0 },
            u_foam_texture_offset: { value: new THREE.Vector2(0, 0) },

            // Fog uniforms
            fogColor: { value: new THREE.Color(GAME_CONFIG.RENDERING.FOG_COLOR) },
            fogDensity: { value: 0.02 }
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
        // Set initial skybox values
        this.skyboxYOffset = 14;

        // Skybox dimensions controlled by CONFIG.SKYBOX.CYLINDER values
        // CONFIG.SKYBOX.CYLINDER.HEIGHT = 73 (actual geometry size in world units)

        // GUI COMMENTED OUT - Skybox now initializes correctly without GUI
        // The fix was to set mesh.scale.set(-1, 1, 1) in SkyboxManager.loadCylindricalSkybox()
        // to match the negatively-scaled geometry
        /*
        // ==================================================================================
        // IMPORTANT: GUI SKYBOX HEIGHT IS A SCALING FACTOR, NOT ACTUAL HEIGHT
        // ==================================================================================
        // The GUI shows a "skyboxHeight" value (e.g., 128) which is a SCALING FACTOR.
        //
        // Actual height calculation:
        //   - updateSkyboxHeight(128) calculates: scale = 128 / 100 = 1.28
        //   - Applied to geometry: 73 × 1.28 = 93.44 units (actual world height)
        //
        // The config file (CONFIG.SKYBOX.CYLINDER.HEIGHT) stores the ACTUAL geometry height.
        // Currently set to 73 units, which was derived from the ideal scaling factor:
        //   - Previous config: 57 units
        //   - GUI scaling factor that looked good: 128
        //   - Actual height produced: 57 × (128/100) = 72.96 ≈ 73 units
        //
        // To change skybox height:
        //   1. Edit CONFIG.SKYBOX.CYLINDER.HEIGHT in config.js (source of truth)
        //   2. OR use this GUI to find ideal value, then update config.js with calculated result
        // ==================================================================================

        // Create GUI for skybox controls
        this.gui = new GUI({ title: 'Skybox Controls' });
        this.gui.domElement.style.position = 'absolute';
        this.gui.domElement.style.top = '10px';
        this.gui.domElement.style.right = '10px';

        this.controls = {
            skyboxHeight: 100,  // Scaling factor (100 = no scaling, represents current config value of 73)
            skyboxYOffset: 14,
            skyboxRadiusX: 139,
            skyboxRadiusZ: 86
        };

        // === SKYBOX CONTROLS ===
        const skyboxFolder = this.gui.addFolder('Skybox Position');

        skyboxFolder.add(this.controls, 'skyboxHeight', 50, 300, 1).name('Height').onChange((v) => {
            this.updateSkyboxHeight(v);
        });

        skyboxFolder.add(this.controls, 'skyboxYOffset', -100, 100, 1).name('Vertical Position').onChange((v) => {
            this.updateSkyboxVerticalPosition(v);
        });

        // NEW: Distance controls
        skyboxFolder.add(this.controls, 'skyboxRadiusX', 50, 200, 1).name('Radius X (E-W)').onChange((v) => {
            this.updateSkyboxRadius(v, this.controls.skyboxRadiusZ);
        });

        skyboxFolder.add(this.controls, 'skyboxRadiusZ', 50, 200, 1).name('Radius Z (N-S)').onChange((v) => {
            this.updateSkyboxRadius(this.controls.skyboxRadiusX, v);
        });

        skyboxFolder.open();
        */
    }

    updateFogDensity(density) {
        // Update water fog
        this.uniforms.fogDensity.value = density;
        this.updateMaterials();

        // Update terrain fog
        if (this.terrainRenderer && this.terrainRenderer.material) {
            this.terrainRenderer.material.uniforms.fogDensity.value = density;
        }

        // Update skybox fog
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            const skybox = this.sceneManager.skyboxManager.skybox;
            if (skybox.material && skybox.material.uniforms && skybox.material.uniforms.fogDensity) {
                skybox.material.uniforms.fogDensity.value = density;
            }
        }

        // Update scene fog
        if (this.sceneManager && this.sceneManager.scene && this.sceneManager.scene.fog) {
            this.sceneManager.scene.fog.density = density;
        }

        console.log('Fog density updated to:', density);
    }

    updateFogColor(hex) {
        const color = new THREE.Color(hex);

        // Update water fog
        this.uniforms.fogColor.value.copy(color);
        this.updateMaterials();

        // Update terrain fog
        if (this.terrainRenderer && this.terrainRenderer.material) {
            this.terrainRenderer.material.uniforms.fogColor.value.copy(color);
        }

        // Update skybox fog
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            const skybox = this.sceneManager.skyboxManager.skybox;
            if (skybox.material && skybox.material.uniforms && skybox.material.uniforms.fogColor) {
                skybox.material.uniforms.fogColor.value.copy(color);
            }
        }

        // Update scene fog
        if (this.sceneManager && this.sceneManager.scene && this.sceneManager.scene.fog) {
            this.sceneManager.scene.fog.color.copy(color);
        }

        console.log('Fog color updated to:', hex);
    }

    updateSkyboxFogHeight(minY, maxY) {
        // Update skybox height-based fog
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            const skybox = this.sceneManager.skyboxManager.skybox;
            if (skybox.material && skybox.material.uniforms) {
                if (skybox.material.uniforms.fogHeightMin) {
                    skybox.material.uniforms.fogHeightMin.value = minY;
                }
                if (skybox.material.uniforms.fogHeightMax) {
                    skybox.material.uniforms.fogHeightMax.value = maxY;
                }
            }
        }

        console.log(`Skybox fog height updated: Min=${minY}, Max=${maxY}`);
    }

    updateSkyboxHeight(height) {
        // Update only the height (Y scale) of the skybox
        // NOTE: 'height' parameter is a SCALING FACTOR, not actual world units
        // Actual world height = CONFIG.SKYBOX.CYLINDER.HEIGHT × (height / 100)
        // Example: If config HEIGHT=73 and height=128, actual = 73 × 1.28 = 93.44 units
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            const skybox = this.sceneManager.skyboxManager.skybox;

            // Calculate scale factor based on baseline of 100
            const baselineFactor = 100;
            const scaleY = height / baselineFactor;

            // Update Y scale while keeping X and Z scale unchanged
            skybox.scale.y = scaleY;

            console.log(`Skybox height scaling factor: ${height} (scale: ${scaleY})`);
        }
    }

    updateSkyboxVerticalPosition(yOffset) {
        // Move the skybox up/down by adjusting its Y position offset
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            // Store the offset so it persists when camera moves
            this.skyboxYOffset = yOffset;

            // The skybox position is updated in the render loop to follow the camera
            // We'll apply the offset in the SkyboxManager update method
            console.log(`Skybox vertical position updated: ${yOffset}`);
        }
    }

    updateSkyboxRadius(radiusX, radiusZ) {
        // Update the distance of skybox from player by scaling X and Z axes
        // NOTE: radiusX/radiusZ parameters are SCALING FACTORS, not actual world units
        // Actual world radius = CONFIG.SKYBOX.CYLINDER.RADIUS_X/Z × (radius / baseline)
        // Example: If config RADIUS_X=139 and radiusX=100, actual = 139 × (100/139) = 100 units
        if (this.sceneManager && this.sceneManager.skyboxManager && this.sceneManager.skyboxManager.skybox) {
            const skybox = this.sceneManager.skyboxManager.skybox;

            // Calculate scale factors based on config baseline dimensions
            // Config values: RADIUS_X=139, RADIUS_Z=86 (actual geometry size in world units)
            const baselineRadiusX = 139;
            const baselineRadiusZ = 86;
            const scaleX = radiusX / baselineRadiusX;
            const scaleZ = radiusZ / baselineRadiusZ;

            // Update X and Z scale while keeping Y scale unchanged
            // Note: X scale is negative because geometry is flipped in SkyboxManager
            skybox.scale.x = -scaleX;
            skybox.scale.z = scaleZ;

            console.log(`Skybox radius scaling factors: X=${radiusX} (scale: ${scaleX}), Z=${radiusZ} (scale: ${scaleZ})`);
        }
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
        const size = 128; // Higher resolution for better accuracy
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
                // Calculate world coordinates matching terrain vertex positions
                // x/size gives 0 to 1, multiply by chunkSize for full range,
                // subtract chunkSize/2 to center at chunk position
                const worldX = chunkX + (x / (size - 1) - 0.5) * chunkSize;
                const worldZ = chunkZ + (y / (size - 1) - 0.5) * chunkSize;
                
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
texture.minFilter = THREE.LinearMipmapLinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.generateMipmaps = true;
texture.anisotropy = 16;
texture.flipY = false;

return texture;
    }

    addWaterChunk(chunkX, chunkZ, heightTexture = null) {
        const key = `${chunkX},${chunkZ}`;
        if (this.waterChunks.has(key)) return;

        // Use old version's geometry settings
        const geometry = new THREE.PlaneGeometry(50, 50, 100, 100);
        geometry.rotateX(-Math.PI / 2);
        geometry.computeBoundingSphere(); // Compute bounding sphere for frustum culling

        // Clone the shared material for each chunk
        const material = this.sharedMaterial.clone();

        // Set chunk-specific uniforms
        material.uniforms.u_chunk_offset.value.set(chunkX, chunkZ);

        // Set height texture if provided
        if (heightTexture) {
            material.uniforms.u_height_texture.value = heightTexture;
            this.heightTextures.set(key, heightTexture);
        }

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkX, this.waterLevel, chunkZ);
        mesh.frustumCulled = true; // Enable frustum culling for performance

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

        // Update reference position for wave curve effect
        if (camera && this.uniforms.u_reference_position) {
            this.uniforms.u_reference_position.value.set(camera.position.x, camera.position.z);
        }

        // Create frustum for visibility checking if camera is provided
        let frustum = null;
        if (camera) {
            frustum = new THREE.Frustum();
            const projScreenMatrix = new THREE.Matrix4();
            projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projScreenMatrix);
        }

        // Update time uniform for each water chunk's material
        this.waterChunks.forEach((mesh, key) => {
            // Skip updating chunks outside camera view (performance optimization)
            if (frustum && mesh.geometry.boundingSphere) {
                // Compute world-space bounding sphere
                const sphere = mesh.geometry.boundingSphere.clone();
                sphere.applyMatrix4(mesh.matrixWorld);

                // Skip if not in frustum
                if (!frustum.intersectsSphere(sphere)) {
                    return;
                }
            }

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
        
    }
}
// generate-map.js - Generates a PNG world map by sampling terrain heights
// Usage: node generate-map.js
// Output: world-map.png (1000x1000 px covering 10,000x10,000 world units centered at 0,0)

const { PNG } = require('pngjs');
const fs = require('fs');

// === TERRAIN CONFIG (extracted from terrainsystem.js) ===
const TERRAIN_CONFIG = {
    HEIGHT_SCALE: 40,
    TERRAIN_FREQUENCY: 0.01,
    TERRAIN_OCTAVES: 6,
    CONTINENT_SPACING: 2000,
    CONTINENT_RADIUS: 500,
    CONTINENT_RADIUS_NOISE: 0.3,
    TRANSITION_ZONE: 150,
    OCEAN_MIN_DEPTH: -30,
};

// === TERRAIN GENERATOR (extracted from terrainsystem.js) ===
class TerrainGenerator {
    constructor(seed = 12345) {
        this.seed = seed;
        this.perm = new Uint8Array(512);
        this.buildPermutationTable(seed);
        this.m00 = 0.8;  this.m01 = -0.6;
        this.m10 = 0.6;  this.m11 = 0.8;
        this.continentCacheSize = 16;
        this.continentCache = new Map();
        this.minDepth = TERRAIN_CONFIG.OCEAN_MIN_DEPTH / TERRAIN_CONFIG.HEIGHT_SCALE;
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

    hashCell(x, y) {
        return this.hash(Math.floor(x), Math.floor(y));
    }

    hashCell2(x, y) {
        return this.hash(Math.floor(x) + 123, Math.floor(y) + 456);
    }

    fastNoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const ux = fx * fx * (3.0 - 2.0 * fx);
        const uy = fy * fy * (3.0 - 2.0 * fy);
        const a = this.hash(ix, iy);
        const b = this.hash(ix + 1, iy);
        const c = this.hash(ix, iy + 1);
        const d = this.hash(ix + 1, iy + 1);
        return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    }

    getCacheKey(cx, cz) {
        return (cx & 0xFFFF) | ((cz & 0xFFFF) << 16);
    }

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

    computeContinentMask(worldX, worldZ) {
        const continent = this.computeContinentInfo(worldX, worldZ);
        const transitionZone = TERRAIN_CONFIG.TRANSITION_ZONE;
        if (continent.distance <= continent.radius) return 1.0;
        const transitionEnd = continent.radius + transitionZone;
        if (continent.distance <= transitionEnd) {
            const t = (continent.distance - continent.radius) / transitionZone;
            const smooth = t * t * (3 - 2 * t);
            return 1.0 - smooth;
        }
        return 0.0;
    }

    getCachedMask(cx, cz) {
        const key = this.getCacheKey(cx, cz);
        if (this.continentCache.has(key)) return this.continentCache.get(key);
        const cellSize = this.continentCacheSize;
        const worldX = (cx + 0.5) * cellSize;
        const worldZ = (cz + 0.5) * cellSize;
        const mask = this.computeContinentMask(worldX, worldZ);
        this.continentCache.set(key, mask);
        if (this.continentCache.size > 50000) {
            const keys = this.continentCache.keys();
            for (let i = 0; i < 10000; i++) this.continentCache.delete(keys.next().value);
        }
        return mask;
    }

    getContinentMask(worldX, worldZ) {
        const cellSize = this.continentCacheSize;
        const fx = worldX / cellSize;
        const fz = worldZ / cellSize;
        const cx = Math.floor(fx);
        const cz = Math.floor(fz);
        const tx = fx - cx;
        const tz = fz - cz;
        const v00 = this.getCachedMask(cx, cz);
        const v10 = this.getCachedMask(cx + 1, cz);
        const v01 = this.getCachedMask(cx, cz + 1);
        const v11 = this.getCachedMask(cx + 1, cz + 1);
        const v0 = v00 * (1 - tx) + v10 * tx;
        const v1 = v01 * (1 - tx) + v11 * tx;
        return v0 * (1 - tz) + v1 * tz;
    }

    terrain(px, py) {
        let x = px, y = py, a = 0, b = 1, dx = 0, dy = 0;
        const octaves = TERRAIN_CONFIG.TERRAIN_OCTAVES;
        for (let i = 0; i < octaves; i++) {
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

    getHeight(worldX, worldZ) {
        const freq = TERRAIN_CONFIG.TERRAIN_FREQUENCY;
        const raw = this.terrain(worldX * freq, worldZ * freq);
        const terrainHeight = (raw + 1.0) * 0.5;
        const continentMask = this.getContinentMask(worldX, worldZ);
        if (continentMask >= 0.999) return terrainHeight;
        if (continentMask <= 0.001) return Math.max(terrainHeight - 1.0, this.minDepth);
        const bias = (1.0 - continentMask) * 1.0;
        return Math.max(terrainHeight - bias, this.minDepth);
    }

    getWorldHeight(worldX, worldZ) {
        return this.getHeight(worldX, worldZ) * TERRAIN_CONFIG.HEIGHT_SCALE;
    }
}

// === APPROXIMATE TEXTURE COLORS (eyeballed from PNG textures) ===
const COLORS = {
    // Water
    waterShallow: [46, 133, 117],    // (0.18, 0.52, 0.46) teal
    waterDeep:    [5, 31, 56],       // (0.02, 0.12, 0.22) dark navy

    // Land textures (average color from PNG observation)
    sand:         [210, 195, 170],   // sand.png - light cream beige
    sandWet:      [170, 145, 100],   // sand2.png - darker wet tan
    grass:        [115, 120, 45],    // blend of grass.png (olive) + grass2.png (dark green)
    rock:         [90, 85, 80],      // rock.png - dark grey gravel
    snow:         [215, 220, 228],   // snow.png - soft grey-white
};

// === COLOR BLENDING (matches shader biome weight logic) ===

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function lerpColor(a, b, t) {
    return [
        Math.round(a[0] * (1 - t) + b[0] * t),
        Math.round(a[1] * (1 - t) + b[1] * t),
        Math.round(a[2] * (1 - t) + b[2] * t),
    ];
}

function getColorForHeight(worldHeight) {
    const heightScale = TERRAIN_CONFIG.HEIGHT_SCALE;

    // --- WATER ---
    if (worldHeight < 0) {
        const depth = -worldHeight;
        // Match shader: depthColorFactor = 1 - exp(-depth / 12)
        const depthFactor = 1.0 - Math.exp(-depth / 12.0);
        return lerpColor(COLORS.waterShallow, COLORS.waterDeep, depthFactor);
    }

    // --- LAND biome weights (from shader getTerrainTexture / ultra-far LOD) ---
    const h = worldHeight / heightScale; // normalized 0-1

    // Sand: full below height 2, fades out by height 4
    let sandWeight = smoothstep(4.0 / heightScale, 2.0 / heightScale, h);

    // Snow: fades in from h=0.55 (height 22) to h=0.95 (height 38)
    let snowWeight = smoothstep(0.55, 0.95, h);

    // Rock: slope-based in shader, but for top-down map use height proxy
    // Steep areas tend to be at mid-high elevations. Add subtle rock at transition zones.
    let rockWeight = smoothstep(0.35, 0.55, h) * 0.3; // light rock presence at grass/snow boundary

    // Grass: everything else
    let grassWeight = 1.0 - sandWeight - snowWeight;
    grassWeight *= smoothstep(0.55, 0.35, h);
    grassWeight = Math.max(0.0, grassWeight - rockWeight * 0.7);

    // Normalize
    const total = sandWeight + grassWeight + rockWeight + snowWeight + 0.001;
    sandWeight /= total;
    grassWeight /= total;
    rockWeight /= total;
    snowWeight /= total;

    // Pick sand sub-type: wet sand below height 1, dry above
    const sandColor = worldHeight < 1.0
        ? lerpColor(COLORS.sandWet, COLORS.sand, worldHeight)
        : COLORS.sand;

    // Blend all biomes
    return [
        Math.round(sandColor[0] * sandWeight + COLORS.grass[0] * grassWeight + COLORS.rock[0] * rockWeight + COLORS.snow[0] * snowWeight),
        Math.round(sandColor[1] * sandWeight + COLORS.grass[1] * grassWeight + COLORS.rock[1] * rockWeight + COLORS.snow[1] * snowWeight),
        Math.round(sandColor[2] * sandWeight + COLORS.grass[2] * grassWeight + COLORS.rock[2] * rockWeight + COLORS.snow[2] * snowWeight),
    ];
}

// === MAIN ===

const MAP_SIZE = 10000;           // world units
const HALF = MAP_SIZE / 2;        // 5000
const SAMPLE_STEP = 10;           // sample every 10 world units
const IMAGE_SIZE = MAP_SIZE / SAMPLE_STEP; // 1000 px

console.error(`Generating ${IMAGE_SIZE}x${IMAGE_SIZE} map (${MAP_SIZE}x${MAP_SIZE} world units, step=${SAMPLE_STEP})...`);

const terrain = new TerrainGenerator(12345);
const png = new PNG({ width: IMAGE_SIZE, height: IMAGE_SIZE });

const startTime = Date.now();

for (let py = 0; py < IMAGE_SIZE; py++) {
    if (py % 100 === 0) {
        console.error(`  Row ${py}/${IMAGE_SIZE} (${Math.round(py / IMAGE_SIZE * 100)}%)`);
    }
    for (let px = 0; px < IMAGE_SIZE; px++) {
        // Map pixel to world coordinates (centered at 0,0)
        // px=0 → worldX = -5000, px=999 → worldX = +4990
        // py=0 → worldZ = -5000 (top of image = north/negative Z)
        const worldX = -HALF + px * SAMPLE_STEP;
        const worldZ = -HALF + py * SAMPLE_STEP;

        const height = terrain.getWorldHeight(worldX, worldZ);
        const color = getColorForHeight(height);

        const idx = (py * IMAGE_SIZE + px) * 4;
        png.data[idx]     = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = 255;
    }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.error(`Done in ${elapsed}s. Writing world-map.png...`);

const outPath = 'world-map.png';
png.pack().pipe(fs.createWriteStream(outPath)).on('finish', () => {
    console.error(`Saved: ${outPath}`);
});

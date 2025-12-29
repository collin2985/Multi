# LOD Slope Issue - Analysis and Solution

## The Problem

When terrain is viewed at distance, slopes that should appear as rock instead appear as grass. As you approach, they "pop" to rock. This is caused by the geometry clipmap system calculating normals with increasingly coarse spacing at distant LOD levels.

### Root Cause

In `ClipmapLevel.computeVertexNormals()` (line ~50990-51046):

```javascript
// For fine normals (close terrain):
const nx = (hL - hR);
const ny = 2.0 * spacing;  // spacing = 2 for fine LOD
const nz = (hD - hU);

// For coarse normals (morphed/distant terrain):
const coarseSpacing = coarserLevel.gridSpacing;  // 16, 32, 64+ units
const cnx = (hLC - hRC);
const cny = 2.0 * coarseSpacing;  // ← THIS IS THE PROBLEM
const cnz = (hDC - hUC);
```

When `coarseSpacing` is large (e.g., 32 units), this "smooths out" the slope:
- A cliff with height difference of 10 units over 2 units = steep slope (normal.y ≈ 0.37)
- Same cliff sampled over 32 units = gentle slope (normal.y ≈ 0.99)

In the shader, `rockWeight = smoothstep(0.0, 0.25, slope)` where `slope = 1.0 - normal.y`:
- Close up: slope = 0.63 → rockWeight = 1.0 (full rock)
- Far away: slope = 0.01 → rockWeight = 0.04 (almost all grass)

---

## Solution A: Store Fine-Resolution Slope as Vertex Attribute (RECOMMENDED)

**Most performance-friendly** - Zero fragment shader cost, CPU calculates once per vertex update.

### Concept
Store the fine-resolution normal Y component as a vertex attribute. Even when the geometry morphs to coarse heights, use the fine-resolution slope for material blending.

### Changes Required

#### 1. Add Attribute Array in ClipmapLevel.createGeometry() (~line 50491)

```javascript
createGeometry() {
    const size = this.size;
    const vertices = size * size;
    
    // ... existing code ...
    this.coarseNormals = new Float32Array(vertices * 3);
    this.coarseHeights = new Float32Array(vertices);
    
    // ADD THIS: Fine-resolution slope for consistent material blending
    this.fineSlopeY = new Float32Array(vertices);  // Store normal.y at fine resolution
    
    // ... rest of initialization ...
    
    // In the loop, initialize:
    this.fineSlopeY[idx] = 1.0;  // Default to flat
}
```

#### 2. Add Buffer Attribute (~line 50543)

```javascript
this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
this.geometry.setAttribute('coarseNormal', new THREE.BufferAttribute(this.coarseNormals, 3));
this.geometry.setAttribute('coarseHeight', new THREE.BufferAttribute(this.coarseHeights, 1));
// ADD THIS:
this.geometry.setAttribute('fineSlopeY', new THREE.BufferAttribute(this.fineSlopeY, 1));
```

#### 3. Calculate Fine Slope in computeVertexNormals() (~line 50990)

```javascript
computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel) {
    const size = this.size;
    const idx = gy * size + gx;

    const halfCells = (size - 1) / 2;
    const worldX = dataCenterX + (gx - halfCells) * spacing;
    const worldY = dataCenterY + (gy - halfCells) * spacing;

    // Fine-resolution height sampling (always use small spacing for slope)
    const FINE_SPACING = 2.0;  // Fixed fine resolution
    const hL = this.getTerrainHeight(worldX - FINE_SPACING, worldY);
    const hR = this.getTerrainHeight(worldX + FINE_SPACING, worldY);
    const hD = this.getTerrainHeight(worldX, worldY - FINE_SPACING);
    const hU = this.getTerrainHeight(worldX, worldY + FINE_SPACING);

    // Calculate and store fine-resolution normal Y
    const fnx = hL - hR;
    const fny = 2.0 * FINE_SPACING;
    const fnz = hD - hU;
    const flen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
    this.fineSlopeY[idx] = fny / flen;  // Normal Y component for slope

    // Geometry normal (for lighting) - uses actual grid spacing
    let hL_geo, hR_geo, hD_geo, hU_geo;
    // ... existing neighbor lookup code ...
    
    const nx = (hL_geo - hR_geo);
    const ny = 2.0 * spacing;
    const nz = (hD_geo - hU_geo);

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    this.normals[idx * 3] = nx / len;
    this.normals[idx * 3 + 1] = ny / len;
    this.normals[idx * 3 + 2] = nz / len;

    // Coarse normal (for LOD morphing) - unchanged
    if (coarserLevel && coarserLevel.initialized) {
        // ... existing coarse normal code, unchanged ...
    } else {
        this.coarseNormals[idx * 3] = this.normals[idx * 3];
        this.coarseNormals[idx * 3 + 1] = this.normals[idx * 3 + 1];
        this.coarseNormals[idx * 3 + 2] = this.normals[idx * 3 + 2];
    }
}
```

#### 4. Update Vertex Shader (~line 50595)

```glsl
attribute float coarseHeight;
attribute vec3 coarseNormal;
attribute float fineSlopeY;  // ADD THIS

uniform float blendStart;
uniform float transitionWidth;
uniform vec2 viewerOffset;
uniform vec2 meshWorldOffset;

varying float vHeight;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec2 vTexCoord;
varying float vFineSlopeY;  // ADD THIS

void main() {
    // ... existing morph code ...
    
    vFineSlopeY = fineSlopeY;  // ADD THIS - pass through to fragment
    
    // ... rest unchanged ...
}
```

#### 5. Update Fragment Shader (~line 50678)

```glsl
varying float vFineSlopeY;  // ADD THIS

void main() {
    // ... existing code ...
    
    // USE FINE SLOPE for material blending (consistent across all LODs)
    float stableSlope = 1.0 - vFineSlopeY;
    
    // Geometry normal slope (for lighting, still uses morphed normal)
    float slope = 1.0 - normal.y;

    vec3 terrainColor = getTerrainTexture(stablePos, normal, vHeight, stableSlope, distToCamera, 0.15, 3);
    
    // ... rest unchanged ...
}
```

#### 6. Mark Buffer for Update After Height Changes (~line 50828)

```javascript
this.geometry.attributes.position.needsUpdate = true;
this.geometry.attributes.normal.needsUpdate = true;
this.geometry.attributes.coarseNormal.needsUpdate = true;
this.geometry.attributes.fineSlopeY.needsUpdate = true;  // ADD THIS
```

---

## Solution B: Calculate Slope in Fragment Shader (Alternative)

If you want to avoid adding a vertex attribute, you can calculate slope in the fragment shader using noise sampling. This is more expensive but requires fewer code changes.

### Fragment Shader Addition

Add to SHADER_NOISE section (~line 48710):

```glsl
// Calculate fine-resolution slope using noise
// This approximates the terrain height function
float calculateFineSlope(vec2 worldXZ) {
    const float FINE_SPACING = 2.0;
    const float FREQ = 0.01;  // TERRAIN_FREQUENCY
    
    float hL = fbm(worldXZ * FREQ + vec2(-FINE_SPACING * FREQ, 0.0), 4);
    float hR = fbm(worldXZ * FREQ + vec2( FINE_SPACING * FREQ, 0.0), 4);
    float hD = fbm(worldXZ * FREQ + vec2(0.0, -FINE_SPACING * FREQ), 4);
    float hU = fbm(worldXZ * FREQ + vec2(0.0,  FINE_SPACING * FREQ), 4);
    
    float nx = hL - hR;
    float ny = 2.0 * FINE_SPACING * FREQ;  // Scaled to noise space
    float nz = hD - hU;
    
    float normalY = ny / sqrt(nx * nx + ny * ny + nz * nz);
    return 1.0 - normalY;
}
```

### Fragment Shader Change

```glsl
// For near/mid terrain, calculate true slope
float stableSlope;
if (distToCamera < 200.0) {
    stableSlope = calculateFineSlope(vTexCoord);
} else {
    stableSlope = 1.0 - vNormal.y;  // Use geometry normal for distant
}
```

**Cost**: ~4 fbm calls × 4 octaves = 16 noise evaluations per pixel within 200 units.

---

## Performance Comparison

| Solution | Fragment Cost | Vertex Cost | Memory | Code Complexity |
|----------|--------------|-------------|--------|-----------------|
| A: Vertex Attribute | 0 | 4 height samples/vertex | +4 bytes/vertex | Medium |
| B: Fragment Shader | ~16 noise calls/pixel | 0 | 0 | Low |

**Recommendation**: Solution A (vertex attribute) is better for performance since:
- Vertices update infrequently (only when LOD shifts)
- Fragment shader runs for every visible pixel every frame
- Height sampling is already done for normal calculation

---

## Implementation Checklist

### Solution A (Recommended):
1. [ ] Add `fineSlopeY` Float32Array in createGeometry()
2. [ ] Add buffer attribute for fineSlopeY
3. [ ] Calculate fine slope in computeVertexNormals() using fixed FINE_SPACING
4. [ ] Add varying to vertex shader to pass fineSlopeY to fragment
5. [ ] Use `vFineSlopeY` for stableSlope in fragment shader
6. [ ] Mark fineSlopeY buffer for update
7. [ ] Apply same changes to SeamLevel class
8. [ ] Test: Walk toward rocky slope, verify no material pop

---

## Quick Verification Test

Before full implementation, verify the diagnosis by temporarily forcing rock on distant terrain:

In ClipmapLevel fragment shader, change:
```glsl
float stableSlope = 1.0 - vNormal.y;
```
to:
```glsl
float stableSlope = 0.5;  // Force rock everywhere
```

If distant hills now correctly show rock, the diagnosis is confirmed.

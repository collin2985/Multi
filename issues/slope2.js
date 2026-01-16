// ============================================================================
// LOD SLOPE FIX - Implementation Patch
// ============================================================================
// 
// This file shows the exact code changes needed to fix the LOD slope issue.
// Rock slopes that appear as grass at distance will now remain rock.
//
// Files to modify:
//   - terrainsystem.js (or wherever ClipmapLevel and SeamLevel are defined)
// ============================================================================


// ============================================================================
// STEP 1: In ClipmapLevel.createGeometry() - Add fineSlopeY array
// ============================================================================

// FIND this section (around line 50497-50502):
/*
        this.normals = new Float32Array(vertices * 3);
        this.coarseNormals = new Float32Array(vertices * 3);
        this.coarseHeights = new Float32Array(vertices);
        this.targetHeights = new Float32Array(vertices);
        this.displayHeights = new Float32Array(vertices);
*/

// REPLACE WITH:
/*
        this.normals = new Float32Array(vertices * 3);
        this.coarseNormals = new Float32Array(vertices * 3);
        this.coarseHeights = new Float32Array(vertices);
        this.targetHeights = new Float32Array(vertices);
        this.displayHeights = new Float32Array(vertices);
        this.fineSlopeY = new Float32Array(vertices);  // ADD: Fine-resolution slope for consistent materials
*/


// ============================================================================
// STEP 2: In the initialization loop - Initialize fineSlopeY
// ============================================================================

// FIND this section (around line 50514-50521):
/*
                this.normals[idx * 3] = 0;
                this.normals[idx * 3 + 1] = 1;
                this.normals[idx * 3 + 2] = 0;
                this.coarseNormals[idx * 3] = 0;
                this.coarseNormals[idx * 3 + 1] = 1;
                this.coarseNormals[idx * 3 + 2] = 0;
*/

// ADD AFTER:
/*
                this.fineSlopeY[idx] = 1.0;  // Default to flat (normal.y = 1)
*/


// ============================================================================
// STEP 3: Add buffer attribute for fineSlopeY
// ============================================================================

// FIND this section (around line 50543-50547):
/*
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
        this.geometry.setAttribute('coarseNormal', new THREE.BufferAttribute(this.coarseNormals, 3));
        this.geometry.setAttribute('coarseHeight', new THREE.BufferAttribute(this.coarseHeights, 1));
        this.geometry.setIndex(indices);
*/

// REPLACE WITH:
/*
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
        this.geometry.setAttribute('coarseNormal', new THREE.BufferAttribute(this.coarseNormals, 3));
        this.geometry.setAttribute('coarseHeight', new THREE.BufferAttribute(this.coarseHeights, 1));
        this.geometry.setAttribute('fineSlopeY', new THREE.BufferAttribute(this.fineSlopeY, 1));  // ADD
        this.geometry.setIndex(indices);
*/


// ============================================================================
// STEP 4: Modify computeVertexNormals() to calculate fine slope
// ============================================================================

// FIND the entire computeVertexNormals method (around line 50990-51047)
// REPLACE WITH this new version:

/*
    computeVertexNormals(gx, gy, dataCenterX, dataCenterY, spacing, coarserLevel) {
        const size = this.size;
        const idx = gy * size + gx;

        const halfCells = (size - 1) / 2;
        const worldX = dataCenterX + (gx - halfCells) * spacing;
        const worldY = dataCenterY + (gy - halfCells) * spacing;

        // ============================================================
        // NEW: Calculate fine-resolution slope (always uses small spacing)
        // This ensures rock/grass materials are consistent across all LOD levels
        // ============================================================
        const FINE_SPACING = 2.0;  // Fixed fine resolution - matches finest LOD
        const hL_fine = this.getTerrainHeight(worldX - FINE_SPACING, worldY);
        const hR_fine = this.getTerrainHeight(worldX + FINE_SPACING, worldY);
        const hD_fine = this.getTerrainHeight(worldX, worldY - FINE_SPACING);
        const hU_fine = this.getTerrainHeight(worldX, worldY + FINE_SPACING);

        const fnx = hL_fine - hR_fine;
        const fny = 2.0 * FINE_SPACING;
        const fnz = hD_fine - hU_fine;
        const flen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
        this.fineSlopeY[idx] = fny / flen;  // Store normal.y for slope calculation

        // ============================================================
        // Existing: Geometry normal (for lighting) - uses actual grid spacing
        // ============================================================
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

        // ============================================================
        // Existing: Coarse normal (for LOD morphing)
        // ============================================================
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
*/


// ============================================================================
// STEP 5: Update buffer needsUpdate flag
// ============================================================================

// FIND this section (around line 50828):
/*
            this.geometry.attributes.coarseNormal.needsUpdate = true;
*/

// ADD AFTER:
/*
            this.geometry.attributes.fineSlopeY.needsUpdate = true;
*/


// ============================================================================
// STEP 6: Update vertex shader - Add attribute and varying
// ============================================================================

// FIND the ClipmapLevel vertex shader (around line 50595-50636)
// The beginning should look like:

/*
            vertexShader: `
                attribute float coarseHeight;
                attribute vec3 coarseNormal;

                uniform float blendStart;
                ...
*/

// CHANGE TO:

/*
            vertexShader: `
                attribute float coarseHeight;
                attribute vec3 coarseNormal;
                attribute float fineSlopeY;  // ADD: Fine-resolution slope

                uniform float blendStart;
                uniform float transitionWidth;
                uniform vec2 viewerOffset;
                uniform vec2 meshWorldOffset;

                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec2 vTexCoord;
                varying float vFineSlopeY;  // ADD: Pass to fragment shader

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
                    vFineSlopeY = fineSlopeY;  // ADD: Pass through (no morphing!)

                    // Stable texture coordinates
                    vTexCoord = meshWorldOffset + pos.xz;

                    vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
                    vWorldPos = worldPos4.xyz;
                    vNormal = morphedNormal;

                    gl_Position = projectionMatrix * viewMatrix * worldPos4;
                }
            `,
*/


// ============================================================================
// STEP 7: Update fragment shader - Use fineSlopeY for materials
// ============================================================================

// FIND the ClipmapLevel fragment shader varying declarations (around line 50644-50648):
/*
                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec2 vTexCoord;
*/

// CHANGE TO:
/*
                varying float vHeight;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec2 vTexCoord;
                varying float vFineSlopeY;  // ADD
*/

// FIND this section in the fragment shader main() (around line 50679-50682):
/*
                    float stableSlope = 1.0 - vNormal.y;
                    float slope = 1.0 - normal.y;

                    vec3 terrainColor = getTerrainTexture(stablePos, normal, vHeight, stableSlope, distToCamera, 0.15, 3);
*/

// CHANGE TO:
/*
                    // Use fine-resolution slope for consistent rock/grass across all LODs
                    float stableSlope = 1.0 - vFineSlopeY;  // CHANGED: Was vNormal.y
                    float slope = 1.0 - normal.y;  // Keep for lighting calculations

                    vec3 terrainColor = getTerrainTexture(stablePos, normal, vHeight, stableSlope, distToCamera, 0.15, 3);
*/


// ============================================================================
// STEP 8: Update shiftArrayData to include fineSlopeY
// ============================================================================

// FIND the shiftArrayData method (around line 50908-50957)
// Add fineSlopeY.copyWithin() calls alongside other arrays

// For deltaGridY > 0 section, ADD:
/*
            this.fineSlopeY.copyWithin(0, deltaGridY * rowSize1);
*/

// For deltaGridY < 0 section, ADD:
/*
            this.fineSlopeY.copyWithin(shift * rowSize1, 0, (size - shift) * rowSize1);
*/

// For deltaGridX > 0 (inside the row loop), ADD:
/*
                this.fineSlopeY.copyWithin(rowStart1, rowStart1 + deltaGridX, rowStart1 + size);
*/

// For deltaGridX < 0 (inside the row loop), ADD:
/*
                this.fineSlopeY.copyWithin(rowStart1 + shift, rowStart1, rowStart1 + (size - shift));
*/


// ============================================================================
// STEP 9: Apply same changes to SeamLevel (if it has similar slope issue)
// ============================================================================

// The SeamLevel class (around line 50100-50430) may also need these changes.
// Look for its vertex and fragment shaders and apply the same fineSlopeY pattern.
// 
// For SeamLevel, the fix is simpler since it has inner and outer vertices:
// - Inner vertices: use fine spacing (already correct)  
// - Outer vertices: calculate fineSlopeY with FINE_SPACING instead of coarseSpacing

// In SeamLevel.updateHeights(), find where outer vertex normals are calculated
// (around line 50410-50423) and add fine slope calculation:

/*
                // Outer vertex - sample from coarse level
                const worldOuterX = realViewerX + outerX;
                const worldOuterZ = realViewerY + outerZ;
                const outerHeight = this.sampleCoarseHeight(worldOuterX, worldOuterZ);

                // NEW: Calculate fine-resolution slope for outer vertex
                const FINE_SPACING = 2.0;
                const hLO_fine = this.getTerrainHeight(worldOuterX - FINE_SPACING, worldOuterZ);
                const hRO_fine = this.getTerrainHeight(worldOuterX + FINE_SPACING, worldOuterZ);
                const hDO_fine = this.getTerrainHeight(worldOuterX, worldOuterZ - FINE_SPACING);
                const hUO_fine = this.getTerrainHeight(worldOuterX, worldOuterZ + FINE_SPACING);

                const fnxO = hLO_fine - hRO_fine;
                const fnyO = 2.0 * FINE_SPACING;
                const fnzO = hDO_fine - hUO_fine;
                const flenO = Math.sqrt(fnxO * fnxO + fnyO * fnyO + fnzO * fnzO);
                this.fineSlopeY[vertIdx] = fnyO / flenO;
*/


// ============================================================================
// PERFORMANCE NOTE
// ============================================================================
// 
// The fix adds 4 additional getTerrainHeight() calls per vertex during normal
// computation. Since vertices only update when the LOD shifts (not every frame),
// this has minimal performance impact.
//
// Memory impact: +4 bytes per vertex (one float for fineSlopeY)
// For a 65x65 terrain level: 65*65*4 = 16,900 bytes = ~17KB per level
// With 6 LOD levels: ~100KB total additional memory
//
// Fragment shader impact: None (just reads a varying instead of computing)
// ============================================================================

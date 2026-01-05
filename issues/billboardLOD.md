# Billboard LOD System Documentation

This document explains how the rock/tree LOD (Level of Detail) system works, enabling AI to implement similar systems for other structures or objects.

---

## System Overview

The LOD system renders thousands of objects efficiently by using:
- **3D instanced models** for close-range (high detail)
- **2D billboards** for far-range (low detail, camera-facing sprites)

Objects smoothly crossfade between these representations based on camera distance.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Object Spawning                          │
│                      (objects.js:852-930)                       │
└─────────────────────┬───────────────────────┬───────────────────┘
                      │                       │
                      ▼                       ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│     RockModelSystem         │   │      BillboardSystem        │
│   (3D Instanced Models)     │   │   (2D Rotating Billboards)  │
│                             │   │                             │
│  Distance: 0-35 units       │   │  Distance: 15-∞ units       │
│  - Full opacity: 0-25       │   │  - Hidden: 0-15             │
│  - Fade out: 25-35          │   │  - Fade in: 15-25           │
│  - Hidden: 35+              │   │  - Full opacity: 25+        │
└─────────────────────────────┘   └─────────────────────────────┘
                      │                       │
                      └───────────┬───────────┘
                                  ▼
                      ┌─────────────────────┐
                      │   Game Loop Update  │
                      │  (game.js:2595-2601)│
                      │  Every ~60 frames   │
                      └─────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `public/RockModelSystem.js` | 3D instanced rock models with distance-based opacity |
| `public/BillboardSystem.js` | 2D camera-facing billboards for trees and rocks |
| `public/objects.js` | Object spawning, registers objects to both systems |
| `public/core/GameInitializer.js` | System instantiation |
| `public/game.js` | Update loop calls |

---

## Core Concepts

### 1. InstancedMesh
Three.js `InstancedMesh` renders many copies of the same geometry in a single draw call. Each instance has its own transform matrix.

```javascript
const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
mesh.setMatrixAt(index, matrix);  // Set transform for instance
mesh.count = activeCount;          // Only render this many instances
```

### 2. Per-Instance Opacity via Shader Injection
Standard materials don't support per-instance opacity. We inject custom shader code:

```javascript
// Add attribute to geometry
const opacityArray = new Float32Array(maxInstances);
geometry.setAttribute('instanceOpacity',
    new THREE.InstancedBufferAttribute(opacityArray, 1));

// Inject into vertex shader
shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
    attribute float instanceOpacity;
    varying float vInstanceOpacity;`
);

// Pass to fragment shader
shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vInstanceOpacity = instanceOpacity;`
);

// Use in fragment shader
shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    `#include <dithering_fragment>
    if (vInstanceOpacity < 0.01) discard;
    gl_FragColor.a *= vInstanceOpacity;`
);
```

### 3. Spatial Partitioning
Instead of iterating all objects every frame, we store objects by chunk:

```javascript
// Store by chunk key
this.objectsByChunk = new Map(); // "chunkX,chunkZ" -> Set of objects

// Only check 3x3 grid around camera
for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
        const chunkKey = `${camChunkX + dx},${camChunkZ + dz}`;
        const objectsInChunk = this.objectsByChunk.get(chunkKey);
        // ... update only these objects
    }
}
```

### 4. Index Pool Management
Reuse instance slots when objects are removed:

```javascript
this.availableIndices = new Set();  // Pool of free indices
this.instanceData = new Map();       // object -> {index, position, ...}

// Add: get index from pool
const index = availableIndices.values().next().value;
availableIndices.delete(index);

// Remove: return index to pool
availableIndices.add(index);
instanceData.delete(object);
```

---

## Implementation Guide

### Step 1: Create the LOD System Class

```javascript
// public/MyObjectLODSystem.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';

export class MyObjectLODSystem {
    constructor(scene) {
        this.scene = scene;

        // Storage
        this.instancedMeshes = [];           // Array of InstancedMesh
        this.instanceData = new Map();       // object -> {index, position, ...}
        this.availableIndices = new Set();   // Free index pool
        this.objectsByChunk = new Map();     // chunkKey -> Set of objects
        this.opacityArray = null;            // Float32Array for opacity

        // Configuration
        this.maxInstances = 10000;
        this.fadeStart = 25;    // Start fading at this distance
        this.fadeEnd = 35;      // Fully hidden at this distance

        // Batch update flags (avoid per-object GPU uploads)
        this.needsMatrixUpdate = false;
        this.needsOpacityUpdate = false;

        // Reusable objects (avoid allocations)
        this._tempMatrix = new THREE.Matrix4();

        // Initialize
        this.loadModel();
    }
```

### Step 2: Load the 3D Model

```javascript
    async loadModel() {
        const loader = new GLTFLoader();

        // Optional: DRACO compression for smaller files
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);

        try {
            const gltf = await loader.loadAsync('./models/myobject.glb');

            // Find meshes in the model
            const meshes = [];
            gltf.scene.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    meshes.push(child);
                }
            });

            // Initialize opacity array
            this.opacityArray = new Float32Array(this.maxInstances);
            this.opacityArray.fill(0);

            // Create InstancedMesh for each mesh in the model
            for (const mesh of meshes) {
                const geometry = mesh.geometry.clone();

                // Bake any transforms from the GLB hierarchy
                mesh.updateWorldMatrix(true, false);
                geometry.applyMatrix4(mesh.matrixWorld);

                // Create material with per-instance opacity
                const material = this.createInstancedMaterial(mesh.material);

                const instancedMesh = new THREE.InstancedMesh(
                    geometry, material, this.maxInstances
                );

                instancedMesh.frustumCulled = false;
                instancedMesh.count = 0;

                // Add opacity attribute
                geometry.setAttribute('instanceOpacity',
                    new THREE.InstancedBufferAttribute(this.opacityArray, 1));

                // Initialize all instances as hidden (scale 0)
                const matrix = new THREE.Matrix4();
                for (let i = 0; i < this.maxInstances; i++) {
                    matrix.makeScale(0, 0, 0);
                    instancedMesh.setMatrixAt(i, matrix);
                }
                instancedMesh.instanceMatrix.needsUpdate = true;

                this.scene.add(instancedMesh);
                this.instancedMeshes.push(instancedMesh);
            }

            // Initialize index pool
            for (let i = 0; i < this.maxInstances; i++) {
                this.availableIndices.add(i);
            }

            this.modelLoaded = true;

        } catch (error) {
            console.error('Failed to load model:', error);
        }
    }
```

### Step 3: Create Material with Per-Instance Opacity

```javascript
    createInstancedMaterial(baseMaterial) {
        const material = baseMaterial.clone();
        material.transparent = true;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;

        material.onBeforeCompile = (shader) => {
            // Vertex shader: declare and pass opacity
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute float instanceOpacity;
                varying float vInstanceOpacity;`
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                vInstanceOpacity = instanceOpacity;`
            );

            // Fragment shader: apply opacity
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying float vInstanceOpacity;`
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                if (vInstanceOpacity < 0.01) discard;
                gl_FragColor.a *= vInstanceOpacity;
                if (gl_FragColor.a < 0.1) discard;`
            );
        };

        // Cache key for shader reuse
        material.customProgramCacheKey = () => 'my_instanced_opacity';

        return material;
    }
```

### Step 4: Add/Remove Instance Methods

```javascript
    addInstance(object, position, rotation = 0, scale = 1) {
        if (!this.modelLoaded || this.availableIndices.size === 0) {
            return -1;
        }

        // Get available index
        const index = this.availableIndices.values().next().value;
        this.availableIndices.delete(index);

        // Calculate chunk key
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const chunkKey = `${chunkX},${chunkZ}`;

        // Store instance data
        this.instanceData.set(object, {
            index,
            position: position.clone(),
            rotation,
            scale,
            chunkKey
        });

        // Add to chunk tracking
        if (!this.objectsByChunk.has(chunkKey)) {
            this.objectsByChunk.set(chunkKey, new Set());
        }
        this.objectsByChunk.get(chunkKey).add(object);

        // Set transform matrix
        this.updateInstanceMatrix(index, position, rotation, scale);

        // Initial opacity = 0 (LOD update will set correct value)
        this.opacityArray[index] = 0;

        // Mark for batch update
        this.needsMatrixUpdate = true;
        this.needsOpacityUpdate = true;

        // Update render count
        const maxIndex = Math.max(...Array.from(this.instanceData.values()).map(d => d.index));
        for (const mesh of this.instancedMeshes) {
            mesh.count = maxIndex + 1;
        }

        return index;
    }

    removeInstance(object) {
        const data = this.instanceData.get(object);
        if (!data) return;

        const { index, chunkKey } = data;

        // Hide by setting scale to 0
        this._tempMatrix.makeScale(0, 0, 0);
        for (const mesh of this.instancedMeshes) {
            mesh.setMatrixAt(index, this._tempMatrix);
        }
        this.needsMatrixUpdate = true;

        // Remove from chunk tracking
        const chunkObjects = this.objectsByChunk.get(chunkKey);
        if (chunkObjects) {
            chunkObjects.delete(object);
            if (chunkObjects.size === 0) {
                this.objectsByChunk.delete(chunkKey);
            }
        }

        // Return index to pool
        this.availableIndices.add(index);
        this.instanceData.delete(object);
    }

    updateInstanceMatrix(index, position, rotation, scale) {
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);

        matrix.compose(
            position,
            quaternion,
            new THREE.Vector3(scale, scale, scale)
        );

        for (const mesh of this.instancedMeshes) {
            mesh.setMatrixAt(index, matrix);
        }
    }
```

### Step 5: LOD Update Method

```javascript
    update(cameraPosition) {
        // Apply pending batch updates
        if (this.needsMatrixUpdate) {
            for (const mesh of this.instancedMeshes) {
                mesh.instanceMatrix.needsUpdate = true;
            }
            this.needsMatrixUpdate = false;
        }

        // Pre-calculate squared distances (avoid sqrt)
        const fadeStartSq = this.fadeStart * this.fadeStart;
        const fadeEndSq = this.fadeEnd * this.fadeEnd;
        const fadeRange = this.fadeEnd - this.fadeStart;

        // Skip thresholds (stable objects don't need updates)
        const skipNearSq = fadeStartSq * 0.7;
        const skipFarSq = fadeEndSq * 1.3;

        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;

        // Get camera chunk
        const { chunkX: camChunkX, chunkZ: camChunkZ } =
            ChunkCoordinates.worldToChunk(camX, camZ);

        let opacityChanged = false;

        // Only iterate objects in 3x3 grid around camera
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${camChunkX + dx},${camChunkZ + dz}`;
                const objectsInChunk = this.objectsByChunk.get(chunkKey);
                if (!objectsInChunk) continue;

                for (const object of objectsInChunk) {
                    const data = this.instanceData.get(object);
                    if (!data) continue;

                    const { index, position } = data;
                    const currentOpacity = this.opacityArray[index];

                    // Calculate squared distance (XZ plane only)
                    const distX = position.x - camX;
                    const distZ = position.z - camZ;
                    const distSq = distX * distX + distZ * distZ;

                    // Skip stable objects
                    if (distSq < skipNearSq && currentOpacity === 1) continue;
                    if (distSq > skipFarSq && currentOpacity === 0) continue;

                    // Calculate target opacity
                    let opacity;
                    if (distSq < fadeStartSq) {
                        opacity = 1;  // Full opacity when close
                    } else if (distSq < fadeEndSq) {
                        const distance = Math.sqrt(distSq);
                        opacity = 1 - (distance - this.fadeStart) / fadeRange;
                    } else {
                        opacity = 0;  // Hidden when far
                    }

                    // Only update if changed significantly
                    if (Math.abs(currentOpacity - opacity) > 0.02) {
                        this.opacityArray[index] = opacity;
                        opacityChanged = true;
                    }
                }
            }
        }

        // Apply opacity updates to GPU
        if (opacityChanged || this.needsOpacityUpdate) {
            for (const mesh of this.instancedMeshes) {
                const attr = mesh.geometry.attributes.instanceOpacity;
                if (attr) attr.needsUpdate = true;
            }
            this.needsOpacityUpdate = false;
        }
    }
}
```

---

## Billboard System (Far Distance)

For objects that need to remain visible at very far distances, add billboard support. The `BillboardSystem` is already set up for this.

### Adding a New Billboard Type

1. **Add to treeTypes array** (`BillboardSystem.js:23`):
```javascript
this.treeTypes = ['oak', 'fir', 'pine', ..., 'myobject'];
```

2. **Add billboard config** (`BillboardSystem.js:26-39`):
```javascript
this.billboardConfig = {
    // ...existing types...
    myobject: {
        width: 2.0,       // Billboard width in world units
        height: 3.0,      // Billboard height
        yOffset: 0,       // Vertical offset from ground
        brightness: 1.0,  // Color multiplier
        colorR: 1.0,      // RGB tint
        colorG: 1.0,
        colorB: 1.0
    }
};
```

3. **Add texture** - Place `myobject.png` or `myobject.webp` in `public/models/`

4. **Update texture path logic** (`BillboardSystem.js:192-206`):
```javascript
if (treeType === 'myobject') {
    texturePath = './models/myobject.webp';
}
```

5. **Set LOD distances** (`BillboardSystem.js:477-508`):
```javascript
// In updateBillboards(), add condition for your type
const uses3DModel = treeType === 'myobject' || treeType === 'limestone' || ...;
```

---

## Integration Points

### 1. Initialize in GameInitializer.js

```javascript
// public/core/GameInitializer.js
import { MyObjectLODSystem } from '../MyObjectLODSystem.js';

// In initializeGame():
this.game.myObjectLODSystem = new MyObjectLODSystem(this.game.scene);
```

### 2. Pass reference to objects.js

```javascript
// public/core/GameInitializer.js, in initializeGame():
modelManager.setMyObjectLODSystem(this.game.myObjectLODSystem);
```

### 3. Register objects when spawning (objects.js)

```javascript
// In generateChunkObjectsBatch():
if (modelType === 'myobject') {
    instance = new THREE.Object3D();
    instance.name = modelType;
    instance.position.copy(position);

    if (this.myObjectLODSystem) {
        this.myObjectLODSystem.addInstance(instance, position, rotation, scale);
    }
}

// Also add billboard for far distance:
if (this.billboardSystem) {
    this.billboardSystem.addTreeBillboard(instance, modelType, position);
}
```

### 4. Update in game loop (game.js)

```javascript
// In animation loop, every ~60 frames:
if (this.myObjectLODSystem) {
    this.myObjectLODSystem.update(playerPosition);
}
```

### 5. Clean up on chunk unload

```javascript
// In removeChunkObject():
if (this.myObjectLODSystem) {
    this.myObjectLODSystem.removeInstance(object);
}
if (this.billboardSystem) {
    this.billboardSystem.removeTreeBillboard(object);
}
```

---

## Performance Optimizations

| Optimization | How It's Done |
|--------------|---------------|
| **Avoid sqrt** | Use squared distances for comparisons |
| **Skip stable objects** | Don't update objects clearly inside/outside fade zone |
| **Spatial partitioning** | Only check 3x3 chunks around camera |
| **Batch GPU uploads** | Use flags, update `needsUpdate` once per frame |
| **Reuse objects** | `_tempMatrix` avoids allocations |
| **Instance pooling** | Reuse indices instead of growing arrays |

---

## LOD Distance Configuration

Typical values:

| Object Type | 3D Model Visible | Fade Zone | Billboard Takes Over |
|-------------|------------------|-----------|---------------------|
| Rocks | 0-25 | 25-35 | 35+ |
| Trees (if 3D) | 0-15 | 15-25 | 25+ |
| Small objects | 0-10 | 10-15 | 15+ |
| Large structures | 0-50 | 50-75 | 75+ |

Adjust based on:
- Object visual importance
- Model complexity (more complex = shorter distance)
- Total object count (more objects = shorter distance)

---

## Debugging

### Check instance counts
```javascript
console.log('Active instances:', this.instanceData.size);
console.log('Available slots:', this.availableIndices.size);
```

### Visualize LOD zones
```javascript
// Temporarily set all opacity to 0.5 to see all instances
for (let i = 0; i < this.opacityArray.length; i++) {
    this.opacityArray[i] = 0.5;
}
```

### Log per-chunk distribution
```javascript
for (const [chunk, objects] of this.objectsByChunk) {
    console.log(`Chunk ${chunk}: ${objects.size} objects`);
}
```

---

## Checklist for New LOD System

- [ ] Create LOD system class with constructor
- [ ] Load 3D model with DRACO support
- [ ] Create instanced material with opacity shader
- [ ] Implement `addInstance()` with index pooling
- [ ] Implement `removeInstance()` with cleanup
- [ ] Implement `update()` with spatial partitioning
- [ ] Add billboard type to BillboardSystem
- [ ] Add billboard texture (PNG/WebP)
- [ ] Initialize system in GameInitializer.js
- [ ] Register objects in objects.js
- [ ] Add update call in game.js loop
- [ ] Handle cleanup on chunk unload
- [ ] Test LOD transitions at various distances

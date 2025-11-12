// Script to measure structure model dimensions
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock self for Node.js environment
global.self = global;

async function measureModel(modelName) {
    return new Promise((resolve, reject) => {
        const modelPath = path.join(__dirname, 'public', 'models', `${modelName}.glb`);

        if (!fs.existsSync(modelPath)) {
            console.log(`Model ${modelName}.glb not found`);
            resolve();
            return;
        }

        const fileBuffer = fs.readFileSync(modelPath);
        const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

        const loader = new GLTFLoader();
        loader.parse(arrayBuffer, '', (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            console.log(`\n=== ${modelName.toUpperCase()} MODEL ===`);
            console.log('Bounding box size:');
            console.log('  Width (X):  ' + size.x.toFixed(4) + ' units');
            console.log('  Height (Y): ' + size.y.toFixed(4) + ' units');
            console.log('  Depth (Z):  ' + size.z.toFixed(4) + ' units');
            console.log('\nFor top-down 2D collision (XZ plane):');
            console.log('  Should use: width=' + size.x.toFixed(2) + ', depth=' + size.z.toFixed(2));

            // Compare with config.js
            const configDims = {
                'market': { width: 2.0, depth: 8.0 },
                'dock': { width: 1.0, depth: 10.0 }
            };

            if (configDims[modelName]) {
                const config = configDims[modelName];
                console.log('\nConfig.js says: width=' + config.width + ', depth=' + config.depth);

                const widthMatch = Math.abs(size.x - config.width) < 0.1;
                const depthMatch = Math.abs(size.z - config.depth) < 0.1;

                if (widthMatch && depthMatch) {
                    console.log('✓ Config MATCHES actual model!');
                } else {
                    console.log('✗ Config DOES NOT MATCH!');
                    if (Math.abs(size.x - config.depth) < 0.1 && Math.abs(size.z - config.width) < 0.1) {
                        console.log('  → Config has width/depth SWAPPED');
                    }
                }
            }

            resolve();
        }, (error) => {
            console.error(`Error parsing ${modelName}:`, error);
            reject(error);
        });
    });
}

// Measure structures
(async () => {
    await measureModel('market');
    await measureModel('dock');
    await measureModel('crate');
    await measureModel('house');
    console.log('\n=========================');
})();

// Script to measure rock model dimensions
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            console.log('\nBounding box center offset from origin:');
            console.log('  X: ' + center.x.toFixed(4));
            console.log('  Y: ' + center.y.toFixed(4));
            console.log('  Z: ' + center.z.toFixed(4));

            const scale = 1.0; // rocks use scale 1.0 in game
            console.log('\nIn-game dimensions (scale = ' + scale + '):');
            console.log('  Width:  ' + (size.x * scale).toFixed(4) + ' game units');
            console.log('  Height: ' + (size.y * scale).toFixed(4) + ' game units');
            console.log('  Depth:  ' + (size.z * scale).toFixed(4) + ' game units');
            console.log('\nMax collision radius (half of max dimension):');
            const maxDim = Math.max(size.x, size.z);
            console.log('  ' + (maxDim / 2).toFixed(4) + ' game units from center');

            resolve();
        }, (error) => {
            console.error(`Error parsing ${modelName}:`, error);
            reject(error);
        });
    });
}

// Measure both rock types
(async () => {
    await measureModel('limestone');
    await measureModel('sandstone');
    await measureModel('oak');
    await measureModel('oak2');
    console.log('\n=========================');
})();

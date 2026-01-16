/**
 * GLB Model Optimizer
 * Reduces texture sizes and applies compression to GLB models
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

// Models to optimize (sorted by size, largest first)
const MODELS_TO_OPTIMIZE = [
    'brownbear.glb',
    'sailboat.glb',
    'apple.glb',
    'ship2.glb',
    'ship.glb',
    'market.glb',
    'garden.glb',
    'tileworks.glb',
    'campfire.glb',
    'house.glb',
    'crate.glb',
    'log.glb',
    'cart.glb',
    'mobilecrate.glb',
    'construction.glb',
    '2x2construction.glb',
    '2x8construction.glb',
    '3x3construction.glb',
];

// Configuration
const CONFIG = {
    modelsDir: path.join(__dirname, 'public', 'models'),
    outputSuffix: '_optimized',
    // Texture settings
    maxTextureSize: 512,  // Max texture dimension (512x512)
    textureFormat: 'webp',
    textureQuality: 80,
};

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function optimizeModel(filename) {
    const inputPath = path.join(CONFIG.modelsDir, filename);
    const baseName = filename.replace('.glb', '');
    const outputPath = path.join(CONFIG.modelsDir, `${baseName}${CONFIG.outputSuffix}.glb`);

    // Check if input exists
    if (!fs.existsSync(inputPath)) {
        console.log(`  Skipping ${filename} - file not found`);
        return null;
    }

    const inputSize = fs.statSync(inputPath).size;
    console.log(`\nOptimizing: ${filename} (${formatBytes(inputSize)})`);

    // Build gltf-transform command
    // Using texture resize and webp compression
    const cmd = `npx gltf-transform optimize "${inputPath}" "${outputPath}" --texture-size ${CONFIG.maxTextureSize} --texture-compress webp --compress draco`;

    try {
        console.log(`  Running optimization...`);
        const { stdout, stderr } = await execPromise(cmd, {
            cwd: __dirname,
            timeout: 300000 // 5 minute timeout per model
        });

        if (stderr && !stderr.includes('warn')) {
            console.log(`  Warnings: ${stderr}`);
        }

        if (fs.existsSync(outputPath)) {
            const outputSize = fs.statSync(outputPath).size;
            const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1);
            console.log(`  Output: ${formatBytes(outputSize)} (${reduction}% reduction)`);

            return {
                filename,
                inputSize,
                outputSize,
                reduction: parseFloat(reduction)
            };
        } else {
            console.log(`  ERROR: Output file not created`);
            return null;
        }
    } catch (error) {
        console.log(`  ERROR: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('GLB Model Optimizer');
    console.log('='.repeat(60));
    console.log(`\nSettings:`);
    console.log(`  Max texture size: ${CONFIG.maxTextureSize}x${CONFIG.maxTextureSize}`);
    console.log(`  Texture format: ${CONFIG.textureFormat}`);
    console.log(`  Output suffix: ${CONFIG.outputSuffix}`);
    console.log(`\nModels to process: ${MODELS_TO_OPTIMIZE.length}`);

    const results = [];

    for (const model of MODELS_TO_OPTIMIZE) {
        const result = await optimizeModel(model);
        if (result) {
            results.push(result);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('OPTIMIZATION SUMMARY');
    console.log('='.repeat(60));

    if (results.length === 0) {
        console.log('No models were successfully optimized.');
        return;
    }

    let totalInputSize = 0;
    let totalOutputSize = 0;

    console.log('\n%-25s %12s %12s %10s'.replace(/%(-?\d+)s/g, (_, n) => `%${n}s`));
    console.log('Model                     Original     Optimized   Reduction');
    console.log('-'.repeat(60));

    for (const result of results) {
        totalInputSize += result.inputSize;
        totalOutputSize += result.outputSize;
        console.log(`${result.filename.padEnd(25)} ${formatBytes(result.inputSize).padStart(12)} ${formatBytes(result.outputSize).padStart(12)} ${(result.reduction + '%').padStart(10)}`);
    }

    console.log('-'.repeat(60));
    const totalReduction = ((1 - totalOutputSize / totalInputSize) * 100).toFixed(1);
    console.log(`${'TOTAL'.padEnd(25)} ${formatBytes(totalInputSize).padStart(12)} ${formatBytes(totalOutputSize).padStart(12)} ${(totalReduction + '%').padStart(10)}`);

    console.log('\n' + '='.repeat(60));
    console.log('Optimized files saved with "_optimized" suffix.');
    console.log('Review the results and rename files as needed.');
    console.log('='.repeat(60));
}

main().catch(console.error);

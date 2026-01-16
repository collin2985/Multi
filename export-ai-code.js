const fs = require('fs');
const path = require('path');

// All AI-related files
const aiFiles = [
    // AI Controllers
    'public/ai/AIController.js',
    'public/ai/BrownBearController.js',
    'public/ai/DeerController.js',
    'public/ai/BaseWorkerController.js',
    'public/ai/WoodcutterController.js',
    'public/ai/BakerController.js',
    'public/ai/GardenerController.js',
    'public/ai/AISpawnQueue.js',
    'public/ai/AIRegistry.js',
    'public/ai/BaseAIController.js',

    // Entity Managers
    'public/entity/AIEnemyManager.js',
    'public/entity/BrownBearManager.js',
    'public/entity/DeerManager.js',

    // Visual Controller
    'public/ai-enemy.js',

    // Navigation
    'public/navigation/NavigationMap.js',
    'public/navigation/NavigationManager.js',
    'public/navigation/AStar.js',

    // Server-side AI
    'server/SpawnerConfig.js',
    'server/BanditLootGenerator.js',

    // Config (AI constants)
    'public/config.js'
];

function exportAICode() {
    const baseDir = __dirname;
    const outputFile = path.join(baseDir, 'AI_CODE.txt');

    console.log('Collecting AI code files...\n');

    let output = '';
    let fileCount = 0;
    let missingFiles = [];

    for (const relativePath of aiFiles) {
        const filePath = path.join(baseDir, relativePath);

        if (!fs.existsSync(filePath)) {
            missingFiles.push(relativePath);
            console.log(`Missing: ${relativePath}`);
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        output += `${'='.repeat(80)}\n`;
        output += `${relativePath}\n`;
        output += `${'='.repeat(80)}\n\n`;
        output += content;
        output += '\n\n';

        fileCount++;
        console.log(`Added: ${relativePath}`);
    }

    fs.writeFileSync(outputFile, output);

    console.log(`\n${'='.repeat(40)}`);
    console.log(`Exported ${fileCount} files to AI_CODE.txt`);
    console.log(`Total size: ${(output.length / 1024).toFixed(1)} KB`);

    if (missingFiles.length > 0) {
        console.log(`\nMissing files (${missingFiles.length}):`);
        missingFiles.forEach(f => console.log(`  - ${f}`));
    }
}

exportAICode();

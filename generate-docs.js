const fs = require('fs');
const path = require('path');

// Files and directories to skip
const SKIP_PATTERNS = [
    'node_modules',
    '.git',
    'chunk_',
    '.glb',
    '.png',
    '.jpg',
    '.mp3',
    '.wav',
    '.JSON',
    'game.js.backup',
    'favicon.ico',
    '.claude'
];

// File extensions to include
const INCLUDE_EXTENSIONS = ['.js', '.html', '.bat'];

/**
 * Count lines in a file
 */
function countLines(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n').length;
    } catch (err) {
        return 0;
    }
}

/**
 * Check if path should be skipped
 */
function shouldSkip(name) {
    return SKIP_PATTERNS.some(pattern => name.includes(pattern));
}

/**
 * Get file category/description
 */
function getFileDescription(filePath) {
    const descriptions = {
        'server.js': 'Main server entry point, WebSocket connections',
        'server/MessageHandlers.js': 'Processes client messages and game state',
        'server/ChunkManager.js': 'Manages world chunks and persistence',
        'public/client.html': 'Main HTML entry point',
        'public/game.js': 'Main client game loop and Three.js scene setup',
        'public/config.js': 'Game constants and configuration parameters',
        'public/objects.js': '3D model loading and object placement',
        'public/terrain.js': 'Procedural terrain generation with Perlin noise',
        'public/WaterRenderer.js': 'Water rendering with waves and foam',
        'public/ui.js': 'Main UI controller for HUD and status displays',
        'public/blobshadow.js': 'Circular blob shadows for objects',
        'public/audio.js': 'Audio system for sounds and music',
        'public/ai-enemy.js': 'AI enemy spawning utilities',
        'public/world/StructureManager.js': 'Structure placement and validation',
        'public/player/PlayerController.js': 'Player input, movement, and camera',
        'public/player/InventorySystem.js': 'Player inventory management',
        'public/ui/BuildMenu.js': 'Construction UI and building placement',
        'public/ui/InventoryUI.js': 'Inventory interface rendering',
        'public/network/MessageRouter.js': 'Client-side WebSocket message routing',
        'public/entity/Enemy.js': 'AI enemy behavior and pathfinding',
        'public/core/GameState.js': 'Central game state management',
        'public/core/EventBus.js': 'Event system for decoupled communication',
        'public/items/ItemDefinitions.js': 'Item types and properties',
        'public/items/CraftingSystem.js': 'Crafting recipes and logic',
        'public/structures/StructureDefinitions.js': 'Structure types and requirements',
        'public/systems/ChunkLoader.js': 'Client-side chunk loading system',
        'public/systems/CameraController.js': 'Camera system and controls',
        'cleanup-game.js': 'Development utility script',
        'start-game.bat': 'Windows launcher batch script',
        'generate-docs.js': 'Documentation generation script'
    };

    return descriptions[filePath] || 'Game code file';
}

/**
 * Scan directory structure
 */
function scanDirectory(dir, baseDir = dir, prefix = '', isLast = true) {
    const items = [];

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // Separate and sort: directories first, then files
        const dirs = entries.filter(e => e.isDirectory() && !shouldSkip(e.name));
        const files = entries.filter(e => e.isFile() && !shouldSkip(e.name) &&
                                     INCLUDE_EXTENSIONS.some(ext => e.name.endsWith(ext)));

        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        const allEntries = [...dirs, ...files];

        allEntries.forEach((entry, index) => {
            const isLastEntry = index === allEntries.length - 1;
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

            const connector = isLastEntry ? '└── ' : '├── ';
            const extension = isLastEntry ? '    ' : '│   ';

            if (entry.isDirectory()) {
                items.push({
                    type: 'dir',
                    line: `${prefix}${connector}${entry.name}/`
                });

                const subItems = scanDirectory(
                    fullPath,
                    baseDir,
                    prefix + extension,
                    isLastEntry
                );
                items.push(...subItems);
            } else {
                const lines = countLines(fullPath);
                const description = getFileDescription(relativePath);
                const formattedLines = lines.toLocaleString();

                items.push({
                    type: 'file',
                    line: `${prefix}${connector}${formattedLines} - ${entry.name} - ${description}`,
                    lines: lines,
                    path: relativePath
                });
            }
        });
    } catch (err) {
        console.error(`Error scanning ${dir}:`, err.message);
    }

    return items;
}

/**
 * Generate documentation
 */
function generateDocumentation() {
    const baseDir = __dirname;
    const items = scanDirectory(baseDir);

    // Calculate totals
    let totalFiles = 0;
    let totalLines = 0;
    let serverFiles = 0;
    let serverLines = 0;
    let clientFiles = 0;
    let clientLines = 0;

    items.forEach(item => {
        if (item.type === 'file') {
            totalFiles++;
            totalLines += item.lines;

            if (item.path.startsWith('server')) {
                serverFiles++;
                serverLines += item.lines;
            } else if (item.path.startsWith('public')) {
                clientFiles++;
                clientLines += item.lines;
            }
        }
    });

    // Generate output
    const date = new Date().toISOString().split('T')[0];
    let output = '';

    output += '================================================================================\n';
    output += '                    HORSES GAME - CODEBASE DOCUMENTATION\n';
    output += '================================================================================\n';
    output += `Generated: ${date}\n\n`;

    output += '================================================================================\n';
    output += 'PROJECT STRUCTURE\n';
    output += '================================================================================\n\n';

    output += 'horses/\n│\n';

    items.forEach(item => {
        output += item.line + '\n';
    });

    output += '\n';
    output += '================================================================================\n';
    output += 'SUMMARY\n';
    output += '================================================================================\n';
    output += `Total Files: ${totalFiles}\n`;
    output += `Total Lines of Code: ${totalLines.toLocaleString()}\n`;
    output += `Server Files: ${serverFiles} (${serverLines.toLocaleString()} lines)\n`;
    output += `Client Files: ${clientFiles} (${clientLines.toLocaleString()} lines)\n`;
    output += '================================================================================\n';

    // Write to file
    const outputPath = path.join(baseDir, 'CODEBASE_DOCUMENTATION.txt');
    fs.writeFileSync(outputPath, output, 'utf8');

    console.log(`Documentation generated: ${outputPath}`);
    console.log(`Total files: ${totalFiles}`);
    console.log(`Total lines: ${totalLines.toLocaleString()}`);
}

// Run
generateDocumentation();

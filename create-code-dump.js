// File: create-code-dump.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\create-code-dump.js
// Description: Creates a code dump of all source files into a single text file

const fs = require('fs');
const path = require('path');

// Define all source files to include in the dump
const filesToDump = [
    'package.json',
    'server.js',
    'public/client.html',
    'public/game.js',
    'public/objects.js',
    'public/terrain.js',
    'public/ui.js',
    'public/WaterRenderer.js',
    'public/audio.js',
    'public/config.js',
    'public/blobshadow.js'
];

// Output file
const outputFile = path.join(__dirname, 'CODE_DUMP.txt');

// Header for the dump
let dumpContent = `
================================================================================
                         CODE DUMP - Multiplayer Game
================================================================================
Generated: ${new Date().toISOString()}
Total Files: ${filesToDump.length}
================================================================================

`;

// Process each file
filesToDump.forEach((filePath, index) => {
    const fullPath = path.join(__dirname, filePath);

    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lineCount = content.split('\n').length;

        dumpContent += `
${'='.repeat(80)}
FILE ${index + 1}/${filesToDump.length}: ${filePath}
Location: ${fullPath}
Lines: ${lineCount}
${'='.repeat(80)}

${content}

`;

        console.log(`✓ Added ${filePath} (${lineCount} lines)`);
    } catch (error) {
        console.error(`✗ Error reading ${filePath}:`, error.message);
        dumpContent += `
${'='.repeat(80)}
FILE ${index + 1}/${filesToDump.length}: ${filePath}
ERROR: Could not read file - ${error.message}
${'='.repeat(80)}

`;
    }
});

// Add footer
dumpContent += `
${'='.repeat(80)}
                              END OF CODE DUMP
${'='.repeat(80)}
`;

// Write the dump file
try {
    fs.writeFileSync(outputFile, dumpContent, 'utf8');
    console.log(`\n✅ Code dump created successfully!`);
    console.log(`📄 Output file: ${outputFile}`);
    console.log(`📊 Total size: ${(dumpContent.length / 1024).toFixed(2)} KB`);
} catch (error) {
    console.error(`\n❌ Error writing dump file:`, error.message);
    process.exit(1);
}

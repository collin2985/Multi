const fs = require('fs');
const path = require('path');

// Configure which files/patterns to include
const includePatterns = [
    'server.js',
    'public/**/*.js',
    'public/**/*.html',
    'server/**/*.js'
];

// Files/folders to exclude
const excludePatterns = [
    'node_modules',
    'export-code.js',
    'generate-docs.js'
];

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        // Skip excluded patterns
        if (excludePatterns.some(pattern => filePath.includes(pattern))) {
            continue;
        }

        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (file.endsWith('.js') || file.endsWith('.html')) {
            fileList.push(filePath);
        }
    }

    return fileList;
}

function exportCode() {
    const baseDir = __dirname;
    const outputFile = path.join(baseDir, 'ALL_CODE.txt');

    console.log('Collecting code files...');

    const files = getAllFiles(baseDir);

    // Sort files for consistent output
    files.sort();

    let output = '';

    for (const filePath of files) {
        const relativePath = path.relative(baseDir, filePath);
        const content = fs.readFileSync(filePath, 'utf8');

        output += `${'='.repeat(80)}\n`;
        output += `${relativePath}\n`;
        output += `${'='.repeat(80)}\n\n`;
        output += content;
        output += '\n\n';

        console.log(`Added: ${relativePath}`);
    }

    fs.writeFileSync(outputFile, output);

    console.log(`\nExported ${files.length} files to ALL_CODE.txt`);
    console.log(`Total size: ${(output.length / 1024).toFixed(1)} KB`);
}

exportCode();

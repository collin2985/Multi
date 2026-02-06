const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

const excludes = ['node_modules', '.git', '.grepai', 'grepai'];

function getAllFiles(dir, fileList = []) {
    for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        if (excludes.some(ex => filePath.includes(ex))) continue;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (file.endsWith('.js') || file.endsWith('.html')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const files = getAllFiles(baseDir);
const results = [];
let total = 0;

for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').length;
    results.push({ file: path.relative(baseDir, filePath), lines });
    total += lines;
}

// Sort by lines descending
results.sort((a, b) => b.lines - a.lines);

// Print
console.log('');
for (const r of results) {
    console.log(`${String(r.lines).padStart(6)}  ${r.file}`);
}
console.log('');
console.log(`${String(total).padStart(6)}  TOTAL (${results.length} files)`);

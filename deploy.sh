#!/bin/bash
# Deployment script for Guns Horses & Ships
# Run from Git Bash: bash deploy.sh "commit message here"

set -e

DEV="C:/Users/colli/Desktop/test horses/horses"
PROD="C:/Users/colli/Desktop/horses"
GIT_BACKUP="C:/Users/colli/Desktop/.git-backup"

# Require commit message
if [ -z "$1" ]; then
    echo "Usage: bash deploy.sh \"commit message\""
    exit 1
fi
COMMIT_MSG="$1"

echo "=== Step 1: Back up dev .git ==="
rm -rf "$GIT_BACKUP"
cp -r "$DEV/.git" "$GIT_BACKUP"
echo "Done."

echo "=== Step 2: Delete production folder ==="
rm -rf "$PROD"
echo "Done."

echo "=== Step 3: Clean dev folder ==="
rm -f "$DEV"/public/chunks/*.JSON 2>/dev/null
rm -f "$DEV"/NUL 2>/dev/null
rm -f "$DEV"/tmpclaude* 2>/dev/null
echo "Done."

echo "=== Step 4: Copy dev to production ==="
cp -r "$DEV" "$PROD"
echo "Done."

echo "=== Step 5: Restore dev .git + add remote ==="
cp -r "$GIT_BACKUP" "$PROD/.git"
rm -rf "$GIT_BACKUP"
cd "$PROD"
# Add the GitHub remote (dev .git won't have it)
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/collin2985/Multi.git
echo "Done."

echo "=== Step 5.5: Validate .gitignore and .env encoding ==="
cd "$PROD"
GITIGNORE_ENC=$(file .gitignore)
ENV_ENC=$(file .env)
if echo "$GITIGNORE_ENC" | grep -qi "utf-16\|little-endian"; then
    echo "ERROR: .gitignore is UTF-16 corrupted! Fix manually."
    exit 1
fi
if echo "$ENV_ENC" | grep -qi "utf-16\|little-endian"; then
    echo "ERROR: .env is UTF-16 corrupted! Fix manually."
    exit 1
fi
echo "Encoding OK."

echo "=== Step 5.6: Ensure git identity ==="
cd "$PROD"
git config user.email "collin2985@gmail.com"
git config user.name "Collin"
echo "Done."

echo "=== Step 6: Clean dev-only files from production ==="
cd "$PROD"
rm -rf nul logs/ .claude/ issues/ node_modules/
rm -f 1.js query-crate.js query-temp.js server-state.json
rm -f terrain-map.png terrain-map.ppm
rm -f *.md
echo "Done."

echo "=== Step 7: Set online mode ==="
sed -i 's/USE_ONLINE_SERVER: false/USE_ONLINE_SERVER: true/' "$PROD/public/config.js"
echo "Done."

echo "=== Step 8: Git add + verify ==="
cd "$PROD"
git add .

# Check for sensitive files being ADDED (not deleted - deletions are fine)
STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
BAD_FILES=""
for pattern in ".env$" "node_modules/" ".grepai/" ".mcp.json" "grepai/" "ALL_CODE.txt" "cheating2.txt" "DEPLOY.md"; do
    if echo "$STAGED" | grep -q "^${pattern}"; then
        BAD_FILES="$BAD_FILES $pattern"
    fi
done

if [ -n "$BAD_FILES" ]; then
    echo "ERROR: Sensitive files staged:$BAD_FILES"
    echo "Fix .gitignore and retry."
    exit 1
fi
echo "Staged files look clean."

echo "=== Step 9: Commit and push ==="
git commit -m "$COMMIT_MSG"
git push --force origin main
echo ""
echo "=== Deploy complete. Render will auto-deploy. ==="

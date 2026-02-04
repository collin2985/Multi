#!/bin/bash
# Deployment script for Guns Horses & Ships
# Run from Git Bash: bash deploy.sh

set -e

# Paths (using forward slashes for Git Bash compatibility)
DEV="/c/Users/colli/Desktop/horses"
BACKUP_ROOT="/c/Users/colli/Desktop/HORSES BACKUP/horses backup"
CONFIG_FILE="$DEV/public/config.js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Guns Horses & Ships Deployment ===${NC}"
echo ""

# Get next backup number
LAST_NUM=$(ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]+' | sed 's/^\([0-9]*\).*/\1/' | sort -n | tail -1)
if [ -z "$LAST_NUM" ]; then
    NEXT_NUM=1
else
    NEXT_NUM=$((LAST_NUM + 1))
fi

# Prompt for backup description
echo -e "${YELLOW}Backup will be saved as: ${NEXT_NUM} <description>${NC}"
read -p "Enter backup description (or press Enter to skip backup): " BACKUP_DESC

# Prompt for commit message
read -p "Enter commit message: " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    echo -e "${RED}Error: Commit message is required${NC}"
    exit 1
fi

# Step 1: Create backup (if description provided)
if [ -n "$BACKUP_DESC" ]; then
    BACKUP_DIR="$BACKUP_ROOT/$NEXT_NUM $BACKUP_DESC"
    echo ""
    echo -e "${GREEN}=== Step 1: Creating backup ===${NC}"
    echo "Destination: $BACKUP_DIR"

    # Copy entire directory
    cp -r "$DEV" "$BACKUP_DIR"

    # Remove node_modules and .git from backup (saves space)
    rm -rf "$BACKUP_DIR/node_modules" "$BACKUP_DIR/.git"

    echo -e "${GREEN}Backup complete.${NC}"
else
    echo ""
    echo -e "${YELLOW}=== Step 1: Skipping backup ===${NC}"
fi

# Step 2: Switch config to online mode
echo ""
echo -e "${GREEN}=== Step 2: Switching to online mode ===${NC}"
sed -i 's/USE_ONLINE_SERVER: false/USE_ONLINE_SERVER: true/' "$CONFIG_FILE"
echo "USE_ONLINE_SERVER set to true"

# Step 3: Git add, commit, push
echo ""
echo -e "${GREEN}=== Step 3: Git commit and push ===${NC}"
cd "$DEV"

git add -A

# Check for any sensitive files that might be staged
STAGED=$(git diff --cached --name-only 2>/dev/null || true)

if echo "$STAGED" | grep -qE '^\.env$'; then
    echo -e "${RED}ERROR: .env is staged! Check your .gitignore${NC}"
    git reset HEAD .env 2>/dev/null || true
    sed -i 's/USE_ONLINE_SERVER: true/USE_ONLINE_SERVER: false/' "$CONFIG_FILE"
    exit 1
fi

# Check if there are any changes to commit
if [ -z "$STAGED" ]; then
    echo -e "${YELLOW}No changes to commit.${NC}"
    sed -i 's/USE_ONLINE_SERVER: true/USE_ONLINE_SERVER: false/' "$CONFIG_FILE"
    echo "Config reverted to local mode."
    exit 0
fi

# Show what will be committed
echo "Files to be committed:"
echo "$STAGED" | head -20
TOTAL_FILES=$(echo "$STAGED" | wc -l)
if [ "$TOTAL_FILES" -gt 20 ]; then
    echo "... and $((TOTAL_FILES - 20)) more files"
fi
echo ""

# Commit and push
git commit -m "$COMMIT_MSG"
git push origin main

echo -e "${GREEN}Push complete.${NC}"

# Step 4: Switch config back to local mode
echo ""
echo -e "${GREEN}=== Step 4: Switching back to local mode ===${NC}"
sed -i 's/USE_ONLINE_SERVER: true/USE_ONLINE_SERVER: false/' "$CONFIG_FILE"
echo "USE_ONLINE_SERVER set to false"

echo ""
echo -e "${GREEN}=== Deployment complete! ===${NC}"
echo "Render will auto-deploy from the push."

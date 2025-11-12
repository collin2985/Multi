// File: public/ui.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\ui.js

// --- UI ELEMENTS ---
let connectionStatusEl;
let peerInfoEl;
let fpsCounterEl;
let physicsStatsEl;
let addBtn;
let removeBtn;
let sawPlanksBtn;
let fishingBtn;
let inventoryToggleBtn;

// Status line timer references for auto-hide
let statusLine1Timer = null;
let statusLine2Timer = null;
let statusLine3Timer = null;

// Helper function for updating status lines (reduces duplication)
function updateStatusLineHelper(lineNumber, message, duration = 3000) {
    const statusLine = document.getElementById(`statusLine${lineNumber}`);
    if (!statusLine) return;

    let timer;
    if (lineNumber === 1) {
        timer = statusLine1Timer;
    } else if (lineNumber === 2) {
        timer = statusLine2Timer;
    } else if (lineNumber === 3) {
        timer = statusLine3Timer;
    }

    if (message) {
        statusLine.textContent = message;
        statusLine.style.display = 'block';

        // Clear existing timer
        if (timer) {
            clearTimeout(timer);
        }

        // Auto-hide after duration (0 = don't hide)
        if (duration > 0) {
            const newTimer = setTimeout(() => {
                statusLine.style.display = 'none';
            }, duration);

            if (lineNumber === 1) {
                statusLine1Timer = newTimer;
            } else if (lineNumber === 2) {
                statusLine2Timer = newTimer;
            } else if (lineNumber === 3) {
                statusLine3Timer = newTimer;
            }
        }
    } else {
        // Clear message
        statusLine.style.display = 'none';
        if (timer) {
            clearTimeout(timer);
            if (lineNumber === 1) {
                statusLine1Timer = null;
            } else if (lineNumber === 2) {
                statusLine2Timer = null;
            } else if (lineNumber === 3) {
                statusLine3Timer = null;
            }
        }
    }
}

// Helper function to build object display text (reduces duplication)
function buildObjectText(objectName, quality, remainingResources, totalResources, suffix = '') {
    const qualityText = quality ? ` (Quality: ${quality})` : '';
    const resourceText = (remainingResources != null && totalResources != null)
        ? ` (${remainingResources}/${totalResources})`
        : '';
    return `${objectName}${qualityText}${resourceText}${suffix}`;
}

// This object will be exported and used by game.js
export const ui = {
    updateStatus(msg) {
        // Status updates no longer logged to console for cleaner output
    },

    updateStatusLine1(message, duration = 3000) {
        updateStatusLineHelper(1, message, duration);
    },

    updateStatusLine2(message, duration = 3000) {
        updateStatusLineHelper(2, message, duration);
    },

    updateStatusLine3(message, duration = 3000) {
        updateStatusLineHelper(3, message, duration);
    },

    updateConnectionStatus(status, message) {
        connectionStatusEl.className = `status-${status}`;
        connectionStatusEl.innerHTML = message;
    },

    updatePeerInfo(peers, avatars) {
        if (!peerInfoEl) return;
        const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
        peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;
    },

    updateNearestObject(objectName, toolCheck, quality, remainingResources, totalResources) {
        const nearestObjectEl = document.getElementById('nearestObject');
        if (!objectName) {
            nearestObjectEl.textContent = 'No object nearby';
        } else if (toolCheck && !toolCheck.hasRequiredTool) {
            nearestObjectEl.textContent = buildObjectText(objectName, quality, remainingResources, totalResources, ` - ${toolCheck.reason}`);
        } else {
            nearestObjectEl.textContent = buildObjectText(objectName, quality, remainingResources, totalResources);
        }
    },

    updateButtonStates(isInChunk, nearestObject, hasAxe, hasSaw, isOnCooldown = false, nearestConstructionSite = null, isMoving = false, nearestStructure = null, hasHammer = false, nearWater = false, hasFishingNet = false) {
        // Always show inventory button (if it exists)
        if (inventoryToggleBtn) {
            inventoryToggleBtn.style.display = 'inline-block';
        }

        // Show/hide construction button based on nearby construction site (hide if moving)
        const constructionBtn = document.getElementById('constructionInventoryBtn');
        if (constructionBtn) {
            constructionBtn.style.display = (nearestConstructionSite && !isMoving) ? 'inline-block' : 'none';
        }

        // Show/hide crate button based on nearby structure (hide if moving)
        const crateBtn = document.getElementById('crateInventoryBtn');
        if (crateBtn) {
            if (nearestStructure && !isMoving) {
                // Update button text based on structure type
                const structureType = nearestStructure.userData?.modelType;

                // Exclude dock and outpost from storage
                if (structureType === 'dock' || structureType === 'outpost') {
                    crateBtn.style.display = 'none';
                } else {
                    const buttonTextMap = {
                        'tent': 'Tent',
                        'crate': 'Crate',
                        'house': 'House',
                        'garden': 'Garden',
                        'market': 'Market'
                    };
                    crateBtn.textContent = buttonTextMap[structureType] || 'Storage';
                    crateBtn.style.display = 'inline-block';
                }
            } else {
                crateBtn.style.display = 'none';
            }
        }

        // Hide addBtn (temporarily disabled)
        addBtn.style.display = 'none';

        // Determine which button to show based on the single nearest object
        const treeTypes = ['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress'];
        const rockTypes = ['limestone', 'sandstone', 'clay'];

        if (nearestObject) {
            const objectType = nearestObject.name;
            const isTree = treeTypes.includes(objectType);
            const isRock = rockTypes.includes(objectType);
            const isLog = objectType === 'log' || objectType.endsWith('_log');

            // Show appropriate button based on object type
            if (isTree) {
                removeBtn.textContent = 'Chop Tree';
                const canChop = isInChunk && hasAxe && !isMoving;
                removeBtn.style.display = canChop ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                // No saw planks button for trees
                sawPlanksBtn.style.display = 'none';
            } else if (isRock) {
                const rockName = objectType.charAt(0).toUpperCase() + objectType.slice(1);
                removeBtn.textContent = `Mine ${rockName}`;
                const hasRequiredTool = nearestObject.toolCheck && nearestObject.toolCheck.hasRequiredTool;
                const hasResources = nearestObject.remainingResources > 0;
                const canMine = isInChunk && hasRequiredTool && hasResources && !isOnCooldown && !isMoving;
                removeBtn.style.display = canMine ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                // No saw planks button for rocks
                sawPlanksBtn.style.display = 'none';
            } else if (isLog) {
                removeBtn.textContent = 'Chop Firewood';
                const canChopFirewood = isInChunk && hasAxe && nearestObject.remainingResources > 0 && !isOnCooldown && !isMoving;
                removeBtn.style.display = canChopFirewood ? 'inline-block' : 'none';
                removeBtn.disabled = false;

                // Saw Planks button - only shows for logs
                sawPlanksBtn.textContent = 'Saw Planks';
                const canSawPlanks = isInChunk && hasSaw && nearestObject.remainingResources > 0 && !isOnCooldown && !isMoving;
                sawPlanksBtn.style.display = canSawPlanks ? 'inline-block' : 'none';
                sawPlanksBtn.disabled = false;
            } else {
                // Unknown object type, hide both buttons
                removeBtn.style.display = 'none';
                sawPlanksBtn.style.display = 'none';
            }
        } else if (nearestStructure && !isMoving) {
            // Handle structure removal
            const structureType = nearestStructure.userData?.modelType;
            const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock'];

            if (structureTypes.includes(structureType)) {
                const structureName = structureType.charAt(0).toUpperCase() + structureType.slice(1);
                removeBtn.textContent = `Demolish ${structureName}`;
                const canDemolish = isInChunk && hasHammer && !isMoving;
                removeBtn.style.display = canDemolish ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                sawPlanksBtn.style.display = 'none';
            } else {
                removeBtn.style.display = 'none';
                sawPlanksBtn.style.display = 'none';
            }
        } else {
            // No object or structure nearby, hide both buttons
            removeBtn.style.display = 'none';
            sawPlanksBtn.style.display = 'none';
        }

        // Fishing button - show when on shore with fishing net
        if (fishingBtn) {
            const canFish = nearWater && hasFishingNet && !isOnCooldown && !isMoving;
            fishingBtn.style.display = canFish ? 'inline-block' : 'none';
        }
    },

    updateFPS(fps) {
        const color = fps >= 50 ? '#7A9060' : fps >= 30 ? '#B89F5C' : '#8B5A5A';
        fpsCounterEl.style.color = color;
        fpsCounterEl.textContent = `FPS: ${fps}`;
    },

    updatePhysicsStats(stats) {
        if (!physicsStatsEl) return;
        if (!stats) {
            physicsStatsEl.textContent = '';
            return;
        }
        const total = stats.totalPhysicsObjects || 0;
        const color = total < 100 ? '#7A9060' : total < 200 ? '#B89F5C' : '#8B5A5A';
        physicsStatsEl.style.color = color;
        physicsStatsEl.textContent = `Physics: ${total} (${stats.rigidBodies}rb ${stats.characterControllers}cc)`;
    },

    updateChoppingProgress(progress) {
        let progressEl = document.getElementById('choppingProgress');

        if (progress === 0) {
            // Hide progress bar
            if (progressEl) {
                progressEl.remove();
            }
            return;
        }

        // Create or update progress bar
        if (!progressEl) {
            progressEl = document.createElement('div');
            progressEl.id = 'choppingProgress';
            progressEl.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                width: 300px;
                height: 30px;
                background: rgba(42, 37, 32, 0.85);
                border: 2px solid #7A9060;
                border-radius: 5px;
                overflow: hidden;
                z-index: 1000;
            `;
            const bar = document.createElement('div');
            bar.id = 'choppingProgressBar';
            bar.style.cssText = `
                height: 100%;
                background: linear-gradient(90deg, #7A9060, #6B7F5C);
                transition: width 0.1s linear;
                width: 0%;
            `;
            progressEl.appendChild(bar);
            document.body.appendChild(progressEl);
        }

        const bar = document.getElementById('choppingProgressBar');
        if (bar) {
            bar.style.width = `${progress * 100}%`;
        }
    },

    // Sets up event listeners, accepting callbacks for actions
    initializeUI(callbacks) {
        // Get UI elements from DOM
        connectionStatusEl = document.getElementById('connectionStatus');
        peerInfoEl = document.getElementById('peerInfo');
        fpsCounterEl = document.getElementById('fpsCounter');
        physicsStatsEl = document.getElementById('physicsStats');
        addBtn = document.getElementById('addBoxBtn');
        removeBtn = document.getElementById('removeBoxBtn');
        sawPlanksBtn = document.getElementById('sawPlanksBtn');
        fishingBtn = document.getElementById('fishingBtn');
        inventoryToggleBtn = document.getElementById('inventoryToggleBtn');

        // Helper to wrap callbacks with audio resume (reduces duplication)
        const withAudioResume = (callback) => () => {
            if (callbacks.resumeAudio) callbacks.resumeAudio();
            callback();
        };

        // Helper to setup button event listeners
        const setupButton = (element, callback) => {
            if (element) element.onclick = withAudioResume(callback);
        };

        // Setup all buttons with audio resume
        setupButton(addBtn, () => {
            const chunkX = callbacks.getCurrentChunkX();
            const chunkZ = callbacks.getCurrentChunkZ();
            callbacks.sendServerMessage('add_box_request', {
                chunkId: `chunk_${chunkX},${chunkZ}`,
                position: { x: 0, y: 0, z: -3 }
            });
        });

        setupButton(removeBtn, () => {
            const target = callbacks.getNearestObject() || callbacks.getNearestStructure();
            callbacks.onRemoveObject(target);
        });

        setupButton(sawPlanksBtn, () => {
            callbacks.onHarvestLog(callbacks.getNearestObject(), 'planks');
        });

        setupButton(fishingBtn, () => {
            callbacks.onStartFishing();
        });

        setupButton(inventoryToggleBtn, () => callbacks.toggleInventory());
        setupButton(document.getElementById('buildMenuToggleBtn'), () => callbacks.toggleBuildMenu());
        setupButton(document.getElementById('constructionInventoryBtn'), () => callbacks.toggleInventory());
        setupButton(document.getElementById('crateInventoryBtn'), () => callbacks.toggleInventory());
        setupButton(document.getElementById('constructionBuildBtn'), () => callbacks.onBuildConstruction());

        window.addEventListener('resize', () => {
            callbacks.onResize();
        });
    }
};
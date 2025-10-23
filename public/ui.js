// File: public/ui.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\ui.js

// --- UI ELEMENTS ---
let connectionStatusEl;
let peerInfoEl;
let fpsCounterEl;
let addBtn;
let removeBtn;
let sawPlanksBtn;
let inventoryToggleBtn;

// Status line timer references for auto-hide
let statusLine1Timer = null;
let statusLine2Timer = null;

// This object will be exported and used by game.js
export const ui = {
    updateStatus(msg) {
        const timestamp = new Date().toLocaleTimeString();
        // Status element removed - only log to console
        console.log(`[${timestamp}] ${msg}`);
    },

    updateStatusLine1(message, duration = 3000) {
        const statusLine1 = document.getElementById('statusLine1');
        if (!statusLine1) return;

        if (message) {
            statusLine1.textContent = message;
            statusLine1.style.display = 'block';

            // Clear existing timer
            if (statusLine1Timer) {
                clearTimeout(statusLine1Timer);
            }

            // Auto-hide after duration (0 = don't hide)
            if (duration > 0) {
                statusLine1Timer = setTimeout(() => {
                    statusLine1.style.display = 'none';
                }, duration);
            }
        } else {
            // Clear message
            statusLine1.style.display = 'none';
            if (statusLine1Timer) {
                clearTimeout(statusLine1Timer);
                statusLine1Timer = null;
            }
        }
    },

    updateStatusLine2(message, duration = 3000) {
        const statusLine2 = document.getElementById('statusLine2');
        if (!statusLine2) return;

        if (message) {
            statusLine2.textContent = message;
            statusLine2.style.display = 'block';

            // Clear existing timer
            if (statusLine2Timer) {
                clearTimeout(statusLine2Timer);
            }

            // Auto-hide after duration (0 = don't hide)
            if (duration > 0) {
                statusLine2Timer = setTimeout(() => {
                    statusLine2.style.display = 'none';
                }, duration);
            }
        } else {
            // Clear message
            statusLine2.style.display = 'none';
            if (statusLine2Timer) {
                clearTimeout(statusLine2Timer);
                statusLine2Timer = null;
            }
        }
    },

    updateConnectionStatus(status, message) {
        connectionStatusEl.className = `status-${status}`;
        connectionStatusEl.innerHTML = message;
    },

    updatePeerInfo(peers, avatars) {
        const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
        peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;
    },

    updateNearestObject(objectName, toolCheck, quality, remainingResources, totalResources) {
        const nearestObjectEl = document.getElementById('nearestObject');
        if (!objectName) {
            nearestObjectEl.textContent = 'No object nearby';
        } else if (toolCheck && !toolCheck.hasRequiredTool) {
            // Show why they can't remove it
            const qualityText = quality ? ` (Quality: ${quality})` : '';
            const resourceText = (remainingResources != null && totalResources != null)
                ? ` (${remainingResources}/${totalResources})`
                : '';
            nearestObjectEl.textContent = `${objectName}${qualityText}${resourceText} - ${toolCheck.reason}`;
        } else {
            const qualityText = quality ? ` (Quality: ${quality})` : '';
            const resourceText = (remainingResources != null && totalResources != null)
                ? ` (${remainingResources}/${totalResources})`
                : '';
            nearestObjectEl.textContent = `${objectName}${qualityText}${resourceText}`;
        }
    },

    updateButtonStates(isInChunk, nearestObject, hasAxe, hasSaw, isOnCooldown = false, nearestConstructionSite = null, isMoving = false, nearestCrate = null) {
        // Always show inventory button (if it exists)
        if (inventoryToggleBtn) {
            inventoryToggleBtn.style.display = 'inline-block';
        }

        // Show/hide construction button based on nearby construction site (hide if moving)
        const constructionBtn = document.getElementById('constructionInventoryBtn');
        if (constructionBtn) {
            constructionBtn.style.display = (nearestConstructionSite && !isMoving) ? 'inline-block' : 'none';
        }

        // Show/hide crate button based on nearby crate (hide if moving)
        const crateBtn = document.getElementById('crateInventoryBtn');
        if (crateBtn) {
            if (nearestCrate && !isMoving) {
                // Update button text based on structure type
                const structureType = nearestCrate.userData?.modelType;
                crateBtn.textContent = structureType === 'tent' ? 'Tent' : 'Crate';
                crateBtn.style.display = 'inline-block';
            } else {
                crateBtn.style.display = 'none';
            }
        }

        // Hide addBtn (temporarily disabled)
        addBtn.style.display = 'none';

        // Set button text and visibility based on object type
        if (nearestObject) {
            const treeTypes = ['oak', 'fir', 'pine', 'cypress'];
            const rockTypes = ['limestone', 'sandstone'];
            const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner'];
            const isLog = nearestObject.name.endsWith('_log') || nearestObject.name === 'log';

            if (treeTypes.includes(nearestObject.name)) {
                // Trees require axe
                removeBtn.textContent = 'Chop Tree';
                const canChop = isInChunk && hasAxe && !isMoving;
                removeBtn.style.display = canChop ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                sawPlanksBtn.style.display = 'none';
            } else if (rockTypes.includes(nearestObject.name)) {
                // Rocks require pickaxe - display specific rock type
                const rockName = nearestObject.name.charAt(0).toUpperCase() + nearestObject.name.slice(1);
                removeBtn.textContent = `Mine ${rockName}`;
                const hasRequiredTool = nearestObject.toolCheck && nearestObject.toolCheck.hasRequiredTool;
                const hasResources = nearestObject.remainingResources > 0;
                const canMine = isInChunk && hasRequiredTool && hasResources && !isOnCooldown && !isMoving;
                removeBtn.style.display = canMine ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                sawPlanksBtn.style.display = 'none';
            } else if (structureTypes.includes(nearestObject.name)) {
                // Structures require hammer to demolish
                removeBtn.textContent = `Demolish ${nearestObject.name}`;
                const hasHammer = nearestObject.toolCheck && nearestObject.toolCheck.hasRequiredTool;
                const canDemolish = isInChunk && hasHammer && !isMoving;
                removeBtn.style.display = canDemolish ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                sawPlanksBtn.style.display = 'none';
            } else if (isLog) {
                // Logs show both buttons (oak_log, pine_log, etc.)
                removeBtn.textContent = 'Chop Firewood';
                const canChopFirewood = isInChunk && hasAxe && nearestObject.remainingResources > 0 && !isOnCooldown && !isMoving;
                removeBtn.style.display = canChopFirewood ? 'inline-block' : 'none';
                removeBtn.disabled = false;

                sawPlanksBtn.textContent = 'Saw Planks';
                const canSawPlanks = isInChunk && hasSaw && nearestObject.remainingResources > 0 && !isOnCooldown && !isMoving;
                sawPlanksBtn.style.display = canSawPlanks ? 'inline-block' : 'none';
                sawPlanksBtn.disabled = false;
            } else {
                removeBtn.textContent = `Remove ${nearestObject.name}`;
                const hasRequiredTool = nearestObject.toolCheck && nearestObject.toolCheck.hasRequiredTool;
                const canRemove = isInChunk && hasRequiredTool && !isMoving;
                removeBtn.style.display = canRemove ? 'inline-block' : 'none';
                removeBtn.disabled = false;
                sawPlanksBtn.style.display = 'none';
            }
        } else {
            // No object nearby - hide all buttons
            removeBtn.style.display = 'none';
            sawPlanksBtn.style.display = 'none';
        }
    },

    updateFPS(fps) {
        const color = fps >= 50 ? '#00ff00' : fps >= 30 ? '#ffff00' : '#ff0000';
        fpsCounterEl.style.color = color;
        fpsCounterEl.textContent = `FPS: ${fps}`;
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
                background: rgba(0, 0, 0, 0.7);
                border: 2px solid #00ff00;
                border-radius: 5px;
                overflow: hidden;
                z-index: 1000;
            `;
            const bar = document.createElement('div');
            bar.id = 'choppingProgressBar';
            bar.style.cssText = `
                height: 100%;
                background: linear-gradient(90deg, #00ff00, #00aa00);
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
        addBtn = document.getElementById('addBoxBtn');
        removeBtn = document.getElementById('removeBoxBtn');
        sawPlanksBtn = document.getElementById('sawPlanksBtn');
        inventoryToggleBtn = document.getElementById('inventoryToggleBtn');

        addBtn.onclick = () => {
            // Resume AudioContext on user interaction (browser requirement)
            if (callbacks.resumeAudio) callbacks.resumeAudio();

            const chunkX = callbacks.getCurrentChunkX();
            const chunkZ = callbacks.getCurrentChunkZ();
            callbacks.sendServerMessage('add_box_request', {  // Keep the message type the same for server compatibility
                chunkId: `chunk_${chunkX},${chunkZ}`,
                position: { x: 0, y: 0, z: -3 }
            });
        };

        removeBtn.onclick = () => {
            // Resume AudioContext on user interaction (browser requirement)
            if (callbacks.resumeAudio) callbacks.resumeAudio();

            callbacks.onRemoveObject(callbacks.getNearestObject());
        };

        sawPlanksBtn.onclick = () => {
            // Resume AudioContext on user interaction (browser requirement)
            if (callbacks.resumeAudio) callbacks.resumeAudio();

            callbacks.onHarvestLog(callbacks.getNearestObject(), 'planks');
        };

        if (inventoryToggleBtn) {
            inventoryToggleBtn.onclick = () => {
                // Resume AudioContext on user interaction (browser requirement)
                if (callbacks.resumeAudio) callbacks.resumeAudio();

                callbacks.toggleInventory();
            };
        }

        const buildMenuToggleBtn = document.getElementById('buildMenuToggleBtn');
        if (buildMenuToggleBtn) {
            buildMenuToggleBtn.onclick = () => {
                // Resume AudioContext on user interaction (browser requirement)
                if (callbacks.resumeAudio) callbacks.resumeAudio();

                callbacks.toggleBuildMenu();
            };
        }

        const constructionInventoryBtn = document.getElementById('constructionInventoryBtn');
        if (constructionInventoryBtn) {
            constructionInventoryBtn.onclick = () => {
                // Resume AudioContext on user interaction (browser requirement)
                if (callbacks.resumeAudio) callbacks.resumeAudio();

                // Open backpack (construction section will show automatically if near site and stopped)
                callbacks.toggleInventory();
            };
        }

        // Crate inventory button
        const crateInventoryBtn = document.getElementById('crateInventoryBtn');
        if (crateInventoryBtn) {
            crateInventoryBtn.onclick = () => {
                // Resume AudioContext on user interaction (browser requirement)
                if (callbacks.resumeAudio) callbacks.resumeAudio();

                // Open backpack (crate section will show automatically if near crate and stopped)
                callbacks.toggleInventory();
            };
        }

        // Construction build button
        const constructionBuildBtn = document.getElementById('constructionBuildBtn');
        if (constructionBuildBtn) {
            constructionBuildBtn.onclick = () => {
                // Resume AudioContext on user interaction (browser requirement)
                if (callbacks.resumeAudio) callbacks.resumeAudio();

                callbacks.onBuildConstruction();
            };
        }

        window.addEventListener('resize', () => {
            callbacks.onResize();
        });
    }
};
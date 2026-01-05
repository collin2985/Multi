// File: public/ui.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\ui.js

import { CONFIG } from './config.js';
import { isPlankType, formatMaterialName } from './ui/InventoryHelpers.js';

// --- UI ELEMENTS ---
let connectionStatusEl;
let p2pStatusEl;
let peerInfoEl;
let fpsCounterEl;
let physicsStatsEl;
let addBtn;
let removeBtn;
let sawPlanksBtn;
let fishingBtn;
let repairStructureBtn;
let demolishStructureBtn;
let inventoryToggleBtn;
let createAccountBtn;

// PERFORMANCE OPTIMIZATION: Cache frequently accessed DOM elements
const domCache = {
    nearestObject: null,
    actionTooltip: null,
    constructionInventoryBtn: null,
    crateInventoryBtn: null,
    climbBtn: null,
    climbDownBtn: null,
    talkMerchantBtn: null,
    merchantDialogueModal: null,
    merchantDialogueText: null,
    merchantDialogueClose: null,
    // Trapper dialogue
    talkTrapperBtn: null,
    trapperDialogueModal: null,
    trapperDialogueText: null,
    trapperResourceList: null,
    trapperPayBtn: null,
    trapperNoBtn: null,
    // Baker dialogue
    talkBakerBtn: null,
    bakerDialogueModal: null,
    bakerDialogueText: null,
    bakerDismissBtn: null,
    // Gardener dialogue
    talkGardenerBtn: null,
    gardenerDialogueModal: null,
    gardenerDialogueText: null,
    gardenerDismissBtn: null,
    // Woodcutter dialogue
    talkWoodcutterBtn: null,
    woodcutterDialogueModal: null,
    woodcutterDialogueText: null,
    woodcutterDismissBtn: null,
    // Miner dialogue
    talkMinerBtn: null,
    minerDialogueModal: null,
    minerDialogueText: null,
    minerDismissBtn: null,
    // Gather buttons
    gatherVinesBtn: null,
    gatherMushroomBtn: null,
    gatherVegetableSeedsBtn: null,
    gatherSeedsBtn: null,
    gatherVegetablesBtn: null,
    harvestDeerBtn: null,
    harvestBrownbearBtn: null,
    // Mobile entity button
    enterMobileEntityBtn: null,
    // Cart buttons
    attachCartBtn: null,
    releaseCartBtn: null,
    // Crate loading buttons (cart must be attached)
    loadCrateBtn: null,
    unloadCrateBtn: null,
    // Status display elements
    playerSpeedLine: null,
    playerPositionLine: null,
    playerRegionLine: null,
    foodStatusLine: null,
    spawnImmunityLine: null,
    inventoryStatusLine: null,
    placementStatus: null,
    initialized: false
};

// PERFORMANCE: Cache button visibility states to avoid redundant DOM updates
const buttonStateCache = {
    merchantBtn: null,
    trapperBtn: null,
    bakerBtn: null,
    gardenerBtn: null,
    woodcutterBtn: null,
    minerBtn: null,
    fishermanBtn: null,
    blacksmithBtn: null,
    ironWorkerBtn: null,
    tileWorkerBtn: null,
    stoneMasonBtn: null
};

// Tooltip text storage for action buttons
const buttonTooltips = new Map();

// Currently hovered button for tooltip display
let hoveredButton = null;

// Initialize DOM cache when document is ready
function initDOMCache() {
    if (domCache.initialized) return;

    domCache.nearestObject = document.getElementById('nearestObject');
    domCache.actionTooltip = document.getElementById('actionTooltip');
    domCache.constructionInventoryBtn = document.getElementById('constructionInventoryBtn');
    domCache.crateInventoryBtn = document.getElementById('crateInventoryBtn');
    domCache.climbBtn = document.getElementById('climbBtn');
    domCache.climbDownBtn = document.getElementById('climbDownBtn');
    domCache.talkMerchantBtn = document.getElementById('talkMerchantBtn');
    domCache.merchantDialogueModal = document.getElementById('merchantDialogueModal');
    domCache.merchantDialogueText = document.getElementById('merchantDialogueText');
    domCache.merchantDialogueClose = document.getElementById('merchantDialogueClose');
    // Trapper dialogue
    domCache.talkTrapperBtn = document.getElementById('talkTrapperBtn');
    domCache.trapperDialogueModal = document.getElementById('trapperDialogueModal');
    domCache.trapperDialogueText = document.getElementById('trapperDialogueText');
    domCache.trapperResourceList = document.getElementById('trapperResourceList');
    domCache.trapperPayBtn = document.getElementById('trapperPayBtn');
    domCache.trapperNoBtn = document.getElementById('trapperNoBtn');
    // Baker dialogue
    domCache.talkBakerBtn = document.getElementById('talkBakerBtn');
    domCache.bakerDialogueModal = document.getElementById('bakerDialogueModal');
    domCache.bakerDialogueText = document.getElementById('bakerDialogueText');
    domCache.bakerDismissBtn = document.getElementById('bakerDismissBtn');
    // Gardener dialogue
    domCache.talkGardenerBtn = document.getElementById('talkGardenerBtn');
    domCache.gardenerDialogueModal = document.getElementById('gardenerDialogueModal');
    domCache.gardenerDialogueText = document.getElementById('gardenerDialogueText');
    domCache.gardenerDismissBtn = document.getElementById('gardenerDismissBtn');
    // Woodcutter dialogue
    domCache.talkWoodcutterBtn = document.getElementById('talkWoodcutterBtn');
    domCache.woodcutterDialogueModal = document.getElementById('woodcutterDialogueModal');
    domCache.woodcutterDialogueText = document.getElementById('woodcutterDialogueText');
    domCache.woodcutterDismissBtn = document.getElementById('woodcutterDismissBtn');
    // Miner dialogue
    domCache.talkMinerBtn = document.getElementById('talkMinerBtn');
    domCache.minerDialogueModal = document.getElementById('minerDialogueModal');
    domCache.minerDialogueText = document.getElementById('minerDialogueText');
    domCache.minerDismissBtn = document.getElementById('minerDismissBtn');
    // Fisherman dialogue
    domCache.talkFishermanBtn = document.getElementById('talkFishermanBtn');
    domCache.fishermanDialogueModal = document.getElementById('fishermanDialogueModal');
    domCache.fishermanDialogueText = document.getElementById('fishermanDialogueText');
    domCache.fishermanDismissBtn = document.getElementById('fishermanDismissBtn');
    // Blacksmith dialogue
    domCache.talkBlacksmithBtn = document.getElementById('talkBlacksmithBtn');
    domCache.blacksmithDialogueModal = document.getElementById('blacksmithDialogueModal');
    domCache.blacksmithDialogueText = document.getElementById('blacksmithDialogueText');
    domCache.blacksmithDismissBtn = document.getElementById('blacksmithDismissBtn');
    // Iron Worker dialogue
    domCache.talkIronWorkerBtn = document.getElementById('talkIronWorkerBtn');
    domCache.ironWorkerDialogueModal = document.getElementById('ironWorkerDialogueModal');
    domCache.ironWorkerDialogueText = document.getElementById('ironWorkerDialogueText');
    domCache.ironWorkerDismissBtn = document.getElementById('ironWorkerDismissBtn');
    // Tile Worker dialogue
    domCache.talkTileWorkerBtn = document.getElementById('talkTileWorkerBtn');
    domCache.tileWorkerDialogueModal = document.getElementById('tileWorkerDialogueModal');
    domCache.tileWorkerDialogueText = document.getElementById('tileWorkerDialogueText');
    domCache.tileWorkerDismissBtn = document.getElementById('tileWorkerDismissBtn');
    // Stone Mason dialogue
    domCache.talkStoneMasonBtn = document.getElementById('talkStoneMasonBtn');
    domCache.stoneMasonDialogueModal = document.getElementById('stoneMasonDialogueModal');
    domCache.stoneMasonDialogueText = document.getElementById('stoneMasonDialogueText');
    domCache.stoneMasonDismissBtn = document.getElementById('stoneMasonDismissBtn');
    // Gather buttons
    domCache.gatherVinesBtn = document.getElementById('gatherVinesBtn');
    domCache.gatherMushroomBtn = document.getElementById('gatherMushroomBtn');
    domCache.gatherVegetableSeedsBtn = document.getElementById('gatherVegetableSeedsBtn');
    domCache.gatherSeedsBtn = document.getElementById('gatherSeedsBtn');
    domCache.gatherVegetablesBtn = document.getElementById('gatherVegetablesBtn');
    domCache.harvestDeerBtn = document.getElementById('harvestDeerBtn');
    domCache.harvestBrownbearBtn = document.getElementById('harvestBrownbearBtn');
    domCache.enterMobileEntityBtn = document.getElementById('enterMobileEntityBtn');
    // Cart buttons
    domCache.attachCartBtn = document.getElementById('attachCartBtn');
    domCache.releaseCartBtn = document.getElementById('releaseCartBtn');
    // Crate loading buttons
    domCache.loadCrateBtn = document.getElementById('loadCrateBtn');
    domCache.unloadCrateBtn = document.getElementById('unloadCrateBtn');
    // Artillery manning buttons
    domCache.manArtilleryBtn = document.getElementById('manArtilleryBtn');
    domCache.leaveArtilleryBtn = document.getElementById('leaveArtilleryBtn');
    domCache.fireArtilleryBtn = document.getElementById('fireArtilleryBtn');
    // Status display elements
    domCache.playerSpeedLine = document.getElementById('playerSpeedLine');
    domCache.playerPositionLine = document.getElementById('playerPositionLine');
    domCache.playerRegionLine = document.getElementById('playerRegionLine');
    domCache.foodStatusLine = document.getElementById('foodStatusLine');
    domCache.spawnImmunityLine = document.getElementById('spawnImmunityLine');
    domCache.inventoryStatusLine = document.getElementById('inventoryStatusLine');
    domCache.placementStatus = document.getElementById('placementStatus');
    domCache.initialized = true;
}

// Show action tooltip for a button
function showActionTooltip(buttonId) {
    if (!domCache.actionTooltip) return;

    const tooltipText = buttonTooltips.get(buttonId);
    if (!tooltipText) {
        domCache.actionTooltip.style.display = 'none';
        return;
    }

    domCache.actionTooltip.innerHTML = tooltipText;
    domCache.actionTooltip.style.display = 'block';
    hoveredButton = buttonId;
}

// Hide action tooltip
function hideActionTooltip() {
    if (domCache.actionTooltip) {
        domCache.actionTooltip.style.display = 'none';
    }
    hoveredButton = null;
}

// Setup hover handlers for a button
function setupButtonTooltip(button) {
    if (!button) return;

    button.addEventListener('mouseenter', () => {
        showActionTooltip(button.id);
    });

    button.addEventListener('mouseleave', () => {
        hideActionTooltip();
    });
}

// Helper function to build object display text (reduces duplication)
function buildObjectText(objectName, quality, remainingResources, totalResources, isGrowing, growthScale, suffix = '') {
    const qualityText = quality ? ` (Quality: ${quality})` : '';

    // For growing trees, show growth percentage instead of resource count
    let resourceText = '';
    if (isGrowing && growthScale != null) {
        // Convert scale (0.25 to 1.0) to percentage
        const growthPercent = Math.round(growthScale * 100);
        resourceText = ` (Growth: ${growthPercent}%)`;
    } else if (remainingResources != null && totalResources != null) {
        // For mature trees and other objects, show resources
        resourceText = ` (${remainingResources}/${totalResources})`;
    }

    return `${objectName}${qualityText}${resourceText}${suffix}`;
}

// Helper function to build tooltip text for natural objects (trees, rocks, logs)
function buildObjectTooltip(nearestObject) {
    if (!nearestObject) return '';

    const objectType = nearestObject.name;
    const quality = nearestObject.quality;
    const remaining = nearestObject.remainingResources;
    const total = nearestObject.totalResources;
    const isGrowing = nearestObject.isGrowing;
    const growthScale = nearestObject.growthScale;

    // Capitalize object name
    let displayName = objectType.charAt(0).toUpperCase() + objectType.slice(1);

    // Handle log types (e.g., "fir_log" -> "Fir Log")
    if (objectType.endsWith('_log')) {
        const treeType = objectType.replace('_log', '');
        displayName = treeType.charAt(0).toUpperCase() + treeType.slice(1) + ' Log';
    } else if (objectType === 'log') {
        displayName = 'Log';
    }

    // Build multi-line tooltip
    let lines = [displayName];

    // Add quality
    if (quality) {
        lines.push(`Quality: ${quality}`);
    }

    // Add growth or resources
    if (isGrowing && growthScale != null) {
        const growthPercent = Math.round(growthScale * 100);
        lines.push(`Growth: ${growthPercent}%`);
    } else if (remaining != null && total != null) {
        lines.push(`Resources: ${remaining}/${total}`);
    }

    return lines.join('<br>');
}

// Helper function to build tooltip text for structures
function buildStructureTooltip(nearestStructure) {
    if (!nearestStructure || !nearestStructure.userData) return '';

    const userData = nearestStructure.userData;
    const structureType = userData.modelType;
    const quality = userData.quality;
    const currentDurability = userData.currentDurability;
    const hoursUntilRuin = userData.hoursUntilRuin;
    const isConstructionSite = userData.isConstructionSite;

    // Capitalize structure name
    let displayName = structureType ? structureType.charAt(0).toUpperCase() + structureType.slice(1) : 'Structure';

    // Handle construction sites
    if (isConstructionSite) {
        const targetName = userData.targetStructure || 'Structure';
        const capitalizedTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
        const minutesLeft = hoursUntilRuin !== undefined ? Math.round(hoursUntilRuin * 60) : 0;
        return `${capitalizedTarget} (Construction)<br>Time Until Removal: ${minutesLeft} min`;
    }

    // Build multi-line tooltip
    let lines = [displayName];

    // Add quality and durability info
    if (quality !== undefined) {
        lines.push(`Quality: ${quality}`);
    }

    if (currentDurability !== undefined) {
        lines.push(`Durability: ${Math.round(currentDurability)}`);
    }

    // Add hours until ruin
    if (hoursUntilRuin !== undefined) {
        if (hoursUntilRuin >= 1) {
            lines.push(`Hours Until Ruined: ${hoursUntilRuin.toFixed(1)}`);
        } else {
            lines.push(`Minutes Until Ruined: ${Math.round(hoursUntilRuin * 60)}`);
        }
    }

    // Add ownership info for houses
    if (structureType === 'house' && userData.owner) {
        if (window.game && window.game.gameState) {
            const owner = userData.owner;
            const currentClientId = window.game.gameState.clientId;
            const currentAccountId = window.game.gameState.accountId;
            const isOwner = (owner === currentClientId || owner === currentAccountId);

            if (isOwner) {
                lines.push('Owner: You');
            } else if (userData.ownerName) {
                lines.push(`Owner: ${userData.ownerName}`);
            }
        }
    }

    return lines.join('<br>');
}

// Helper function to build tooltip text for repair button
function buildRepairTooltip(nearestStructure) {
    const structureInfo = buildStructureTooltip(nearestStructure);
    if (!structureInfo) return '';

    // Get structure-specific material requirements
    const structureType = nearestStructure?.userData?.modelType;
    const requiredMaterials = structureType ? CONFIG.CONSTRUCTION.MATERIALS[structureType] : null;

    let materialsText = '';
    if (requiredMaterials) {
        const materialList = Object.entries(requiredMaterials).map(([mat, qty]) => {
            const displayName = formatMaterialName(mat);
            return `${qty} ${displayName}`;
        }).join(', ');
        materialsText = `<br>Consumes: ${materialList}`;
    }

    return structureInfo + '<br><br>Resets decay timer.<br>Quality averaged with materials.' + materialsText;
}

// This object will be exported and used by game.js
export const ui = {
    updateStatus(msg) {
        // Status updates no longer logged to console for cleaner output
    },

    /**
     * Show structure panel with info about nearby structure
     * @param {string} name - Structure name (e.g., "House | Quality: 75")
     * @param {string} durability - Durability info (e.g., "Durability: 50/75 (66%) | 12.5 hours")
     * @param {string} owner - Owner info (e.g., "Owner: You") - optional
     */
    showStructurePanel(name, durability, owner = null) {
        const panel = document.getElementById('structurePanel');
        const nameEl = document.getElementById('structureName');
        const durabilityEl = document.getElementById('structureDurability');
        const ownerEl = document.getElementById('structureOwner');

        if (!panel) return;

        // Check if proximate status is enabled in settings
        if (!window.proximateStatusVisible) {
            panel.style.display = 'none';
            return;
        }

        nameEl.textContent = name || '';
        durabilityEl.textContent = durability || '';
        ownerEl.textContent = owner || '';
        ownerEl.style.display = owner ? 'block' : 'none';

        panel.style.display = 'block';
    },

    /**
     * Hide structure panel
     */
    hideStructurePanel() {
        const panel = document.getElementById('structurePanel');
        if (panel) {
            panel.style.display = 'none';
        }
    },

    /**
     * Show a toast notification that stacks and auto-dismisses
     * @param {string} message - Message to display
     * @param {string} type - 'info', 'success', 'warning', 'error'
     * @param {number} duration - Duration in ms (default 3000)
     */
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            toast.classList.add('fadeOut');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300); // Match fadeOut animation duration
        }, duration);
    },

    /**
     * Show a confirmation dialog with custom message
     * @param {string} message - The message to display
     * @returns {Promise<boolean>} - Resolves true if OK clicked, false if cancelled
     */
    showConfirmDialog(message) {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirmDialog');
            const messageEl = document.getElementById('confirmDialogMessage');
            const okBtn = document.getElementById('confirmDialogOk');
            const cancelBtn = document.getElementById('confirmDialogCancel');

            if (!dialog) {
                // Fallback to browser confirm if dialog not found
                resolve(confirm(message));
                return;
            }

            messageEl.textContent = message;
            dialog.style.display = 'flex';

            // Clean up old listeners
            const newOkBtn = okBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

            newOkBtn.addEventListener('click', () => {
                dialog.style.display = 'none';
                resolve(true);
            });

            newCancelBtn.addEventListener('click', () => {
                dialog.style.display = 'none';
                resolve(false);
            });
        });
    },

    updateConnectionStatus(status, message) {
        // Get element directly if not cached yet
        if (!connectionStatusEl) {
            connectionStatusEl = document.getElementById('connectionStatus');
        }
        if (!connectionStatusEl) return;

        connectionStatusEl.className = `status-${status}`;
        connectionStatusEl.innerHTML = message;

        // Hide when connected (no message needed), show for all other states
        connectionStatusEl.style.display = (status === 'connected' && !message) ? 'none' : 'block';

        // Add click handler for 'failed' state to trigger manual reconnect
        if (status === 'failed') {
            connectionStatusEl.onclick = () => {
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.manualReconnect();
                }
            };
        } else {
            connectionStatusEl.onclick = null;
        }

        // Update global connection state for action blocking
        this._serverConnected = (status === 'connected');
    },

    /**
     * Check if server is connected (for action blocking)
     * @returns {boolean}
     */
    isServerConnected() {
        return this._serverConnected !== false;
    },

    /**
     * Update P2P connection status banner
     * Shows when there are missing peer connections
     * @param {number} connected - Number of connected peers
     * @param {number} expected - Number of expected peers
     */
    updateP2PStatus(connected, expected) {
        if (!p2pStatusEl) {
            p2pStatusEl = document.getElementById('p2pStatus');
        }
        if (!p2pStatusEl) return;

        // Only show when degraded (missing connections)
        if (expected > 0 && connected < expected) {
            p2pStatusEl.textContent = `P2P: ${connected}/${expected}`;
            p2pStatusEl.className = 'degraded';
        } else {
            p2pStatusEl.className = '';
        }
    },

    updatePeerInfo(peers, avatars) {
        if (!peerInfoEl) return;
        const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
        peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;

        // Also update P2P status banner (shows when degraded)
        this.updateP2PStatus(connectedPeers.length, peers.size);
    },

    updateNearestObject(objectName, toolCheck, quality, remainingResources, totalResources, isGrowing, growthScale) {
        // Ensure DOM cache is initialized
        if (!domCache.initialized) initDOMCache();

        const nearestObjectEl = domCache.nearestObject;
        if (!nearestObjectEl) return;

        // Check if proximate status is enabled in settings
        if (!window.proximateStatusVisible) {
            nearestObjectEl.style.display = 'none';
            return;
        }

        if (!objectName) {
            nearestObjectEl.style.display = 'none';
            return;
        }
        nearestObjectEl.style.display = 'block';
        if (toolCheck && !toolCheck.hasRequiredTool) {
            nearestObjectEl.textContent = buildObjectText(objectName, quality, remainingResources, totalResources, isGrowing, growthScale, ` - ${toolCheck.reason}`);
        } else {
            nearestObjectEl.textContent = buildObjectText(objectName, quality, remainingResources, totalResources, isGrowing, growthScale);
        }
    },

    updateButtonStates(isInChunk, nearestObject, hasAxe, hasSaw, isOnCooldown = false, nearestConstructionSite = null, isMoving = false, nearestStructure = null, hasHammer = false, nearWater = false, hasFishingNet = false, onGrass = false, mushroomAvailable = false, vegetableSeedsAvailable = false, seedsAvailable = false, seedTreeType = null, isClimbing = false, occupiedOutposts = null, vegetablesGatherAvailable = false, activeAction = null, nearestMobileEntity = null, mobileEntityState = null, canDisembark = false, nearestDeerCorpse = null, nearestBrownbearCorpse = null, nearestTowableEntity = null, cartAttachmentState = null, nearestLoadableCrate = null, crateLoadState = null, artilleryAttachmentState = null, nearestMannableArtillery = null, artilleryManningState = null) {
        // Ensure DOM cache is initialized
        if (!domCache.initialized) initDOMCache();

        // Early return if UI not fully initialized yet (buttons assigned in init())
        if (!removeBtn || !sawPlanksBtn) return;

        // Check if player is mounted (piloting a mobile entity like horse)
        const isMounted = mobileEntityState?.isActive && mobileEntityState?.phase === 'piloting';

        // If mounted, hide all action buttons except the mobile entity button
        if (isMounted) {
            removeBtn.style.display = 'none';
            sawPlanksBtn.style.display = 'none';
            if (domCache.constructionInventoryBtn) domCache.constructionInventoryBtn.style.display = 'none';
            if (domCache.crateInventoryBtn) domCache.crateInventoryBtn.style.display = 'none';

            // Special case - allow Market button when on horse near market for selling
            const isOnHorse = mobileEntityState?.entityType === 'horse';
            const nearMarket = nearestStructure?.userData?.modelType === 'market';
            if (isOnHorse && nearMarket && !isMoving) {
                if (domCache.crateInventoryBtn) {
                    domCache.crateInventoryBtn.textContent = 'Sell Horse';
                    domCache.crateInventoryBtn.style.display = 'inline-block';
                    domCache.crateInventoryBtn.disabled = false;
                }
            }

            if (domCache.climbBtn) domCache.climbBtn.style.display = 'none';
            if (domCache.climbDownBtn) domCache.climbDownBtn.style.display = 'none';
            if (domCache.talkMerchantBtn) domCache.talkMerchantBtn.style.display = 'none';
            if (domCache.gatherVinesBtn) domCache.gatherVinesBtn.style.display = 'none';
            if (domCache.gatherMushroomBtn) domCache.gatherMushroomBtn.style.display = 'none';
            if (domCache.gatherVegetableSeedsBtn) domCache.gatherVegetableSeedsBtn.style.display = 'none';
            if (domCache.gatherSeedsBtn) domCache.gatherSeedsBtn.style.display = 'none';
            if (domCache.gatherVegetablesBtn) domCache.gatherVegetablesBtn.style.display = 'none';
            if (domCache.harvestDeerBtn) domCache.harvestDeerBtn.style.display = 'none';
            if (domCache.harvestBrownbearBtn) domCache.harvestBrownbearBtn.style.display = 'none';
            if (repairStructureBtn) repairStructureBtn.style.display = 'none';
            if (demolishStructureBtn) demolishStructureBtn.style.display = 'none';
            if (fishingBtn) fishingBtn.style.display = 'none';
            // Crate loading buttons hidden when mounted
            if (domCache.loadCrateBtn) domCache.loadCrateBtn.style.display = 'none';
            if (domCache.unloadCrateBtn) domCache.unloadCrateBtn.style.display = 'none';
            // Mobile entity button is handled separately below
            // Skip the rest of button state updates while mounted
        }

        // If manning artillery, hide all action buttons except Fire, Leave Artillery, and Inventory
        const isManningArtillery = artilleryManningState?.isManning;
        if (isManningArtillery) {
            removeBtn.style.display = 'none';
            sawPlanksBtn.style.display = 'none';
            if (domCache.constructionInventoryBtn) domCache.constructionInventoryBtn.style.display = 'none';
            if (domCache.crateInventoryBtn) domCache.crateInventoryBtn.style.display = 'none';
            if (domCache.climbBtn) domCache.climbBtn.style.display = 'none';
            if (domCache.climbDownBtn) domCache.climbDownBtn.style.display = 'none';
            if (domCache.talkMerchantBtn) domCache.talkMerchantBtn.style.display = 'none';
            if (domCache.talkTrapperBtn) domCache.talkTrapperBtn.style.display = 'none';
            if (domCache.talkBakerBtn) domCache.talkBakerBtn.style.display = 'none';
            if (domCache.talkGardenerBtn) domCache.talkGardenerBtn.style.display = 'none';
            if (domCache.talkWoodcutterBtn) domCache.talkWoodcutterBtn.style.display = 'none';
            if (domCache.talkMinerBtn) domCache.talkMinerBtn.style.display = 'none';
            if (domCache.gatherVinesBtn) domCache.gatherVinesBtn.style.display = 'none';
            if (domCache.gatherMushroomBtn) domCache.gatherMushroomBtn.style.display = 'none';
            if (domCache.gatherVegetableSeedsBtn) domCache.gatherVegetableSeedsBtn.style.display = 'none';
            if (domCache.gatherSeedsBtn) domCache.gatherSeedsBtn.style.display = 'none';
            if (domCache.gatherVegetablesBtn) domCache.gatherVegetablesBtn.style.display = 'none';
            if (domCache.harvestDeerBtn) domCache.harvestDeerBtn.style.display = 'none';
            if (domCache.harvestBrownbearBtn) domCache.harvestBrownbearBtn.style.display = 'none';
            if (repairStructureBtn) repairStructureBtn.style.display = 'none';
            if (demolishStructureBtn) demolishStructureBtn.style.display = 'none';
            if (fishingBtn) fishingBtn.style.display = 'none';
            if (domCache.loadCrateBtn) domCache.loadCrateBtn.style.display = 'none';
            if (domCache.unloadCrateBtn) domCache.unloadCrateBtn.style.display = 'none';
            if (domCache.attachCartBtn) domCache.attachCartBtn.style.display = 'none';
            if (domCache.releaseCartBtn) domCache.releaseCartBtn.style.display = 'none';
            if (domCache.enterMobileEntityBtn) domCache.enterMobileEntityBtn.style.display = 'none';
            if (domCache.manArtilleryBtn) domCache.manArtilleryBtn.style.display = 'none';
            // Fire and Leave Artillery buttons are handled later in the artillery section
        }

        // Always show inventory button (if it exists)
        if (inventoryToggleBtn) {
            inventoryToggleBtn.style.display = 'inline-block';
        }

        // Show/hide construction button based on nearby construction site (hide if moving)
        const constructionBtn = domCache.constructionInventoryBtn;
        if (constructionBtn && !isMounted && !isManningArtillery) {
            const showConstruction = nearestConstructionSite && !isMoving;
            constructionBtn.style.display = showConstruction ? 'inline-block' : 'none';
            // Set tooltip for construction button
            if (showConstruction && nearestConstructionSite.userData) {
                const targetName = nearestConstructionSite.userData.targetStructure || 'Structure';
                const capitalizedTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
                const hoursUntilRuin = nearestConstructionSite.userData.hoursUntilRuin;
                const minutesLeft = hoursUntilRuin !== undefined ? Math.round(hoursUntilRuin * 60) : 0;
                buttonTooltips.set('constructionInventoryBtn', `${capitalizedTarget} (Construction)<br>Time Until Removal: ${minutesLeft} min`);
            } else {
                buttonTooltips.delete('constructionInventoryBtn');
            }
        }

        // Show/hide crate button based on nearby structure (hide if moving)
        const crateBtn = domCache.crateInventoryBtn;
        if (crateBtn && !isMounted && !isManningArtillery) {
            if (nearestStructure && !isMoving) {
                // Update button text based on structure type
                const structureType = nearestStructure.userData?.modelType;
                const isConstructionSite = nearestStructure.userData?.isConstructionSite;

                // Exclude dock, outpost, construction sites, and decorative structures from storage
                const noStorageTypes = ['dock', 'outpost', 'stonemason', 'gardener', 'miner', 'woodcutter', 'bearden'];
                if (noStorageTypes.includes(structureType) || isConstructionSite) {
                    crateBtn.style.display = 'none';
                } else {
                    // Check ownership for houses
                    let isOwner = true;
                    if (structureType === 'house' && nearestStructure.userData?.owner) {
                        // Check if we have access to game state for ownership check
                        if (window.game && window.game.gameState) {
                            const owner = nearestStructure.userData.owner;
                            const currentClientId = window.game.gameState.clientId;
                            const currentAccountId = window.game.gameState.accountId;
                            isOwner = (owner === currentClientId || owner === currentAccountId);
                        }
                    }

                    const buttonTextMap = {
                        'tent': 'Tent',
                        'crate': 'Crate',
                        'house': isOwner ? 'House' : '🔒 House',
                        'garden': 'Garden',
                        'apple': 'Apple Tree',
                        'market': 'Market',
                        'campfire': 'Campfire',
                        'tileworks': 'Tileworks',
                        'ironworks': 'Ironworks',
                        'blacksmith': 'Blacksmith',
                        'bakery': 'Bakery',
                        'fisherman': 'Fisherman',
                        'artillery': 'Artillery'
                    };
                    crateBtn.textContent = buttonTextMap[structureType] || 'Storage';
                    crateBtn.style.display = 'inline-block';

                    // Check if apple tree is growing
                    const isGrowingAppleTree = structureType === 'apple' && nearestStructure.userData?.isGrowing;

                    // Disable button for non-owned houses OR growing apple trees
                    crateBtn.disabled = (structureType === 'house' && !isOwner) || isGrowingAppleTree;
                    if (crateBtn.disabled) {
                        crateBtn.style.opacity = '0.5';
                        crateBtn.style.cursor = 'not-allowed';
                    } else {
                        crateBtn.style.opacity = '1';
                        crateBtn.style.cursor = 'pointer';
                    }

                    // Build tooltip with durability info
                    const quality = nearestStructure.userData?.quality;
                    const currentDurability = nearestStructure.userData?.currentDurability;
                    const hoursUntilRuin = nearestStructure.userData?.hoursUntilRuin;
                    const structureName = buttonTextMap[structureType] || 'Structure';

                    let tooltip = structureName;
                    if (quality !== undefined && currentDurability !== undefined) {
                        const durabilityPercent = quality > 0 ? ((currentDurability / quality) * 100).toFixed(0) : 0;
                        tooltip += `<br>Quality: ${quality}`;
                        tooltip += `<br>Durability: ${currentDurability.toFixed(1)}/${quality} (${durabilityPercent}%)`;
                        if (hoursUntilRuin !== undefined && hoursUntilRuin > 0) {
                            tooltip += `<br>Decays in: ${hoursUntilRuin.toFixed(1)}h`;
                        }
                    }
                    if (structureType === 'house' && !isOwner) {
                        tooltip += `<br><span class="tooltip-warning">Not your house</span>`;
                    }

                    // Add growth progress for growing apple trees
                    if (isGrowingAppleTree) {
                        const growthScale = nearestStructure.userData?.scale || 0.25;
                        const growthPercent = Math.round(growthScale * 100);
                        tooltip += `<br>Growth: ${growthPercent}%`;
                        tooltip += `<br><span class="tooltip-warning">Not Ready</span>`;
                    }

                    // Check dock/market connections for trading
                    const TRADE_RANGE = 20; // Must match server CONFIG.SHIP_TRADING.MAX_DISTANCE
                    const structurePos = nearestStructure.position;

                    if (structureType === 'market') {
                        // Find nearest dock to this market
                        // Only calculate once per structure (buildings don't move)
                        const marketId = nearestStructure.userData?.objectId;
                        if (!ui._marketDockCache || ui._marketDockCache.marketId !== marketId) {
                            let nearestDockDist = Infinity;
                            if (window.game?.chunkManager?.chunkObjects) {
                                for (const objects of window.game.chunkManager.chunkObjects.values()) {
                                    for (const obj of objects) {
                                        if (obj.userData?.modelType === 'dock') {
                                            const dx = structurePos.x - obj.position.x;
                                            const dz = structurePos.z - obj.position.z;
                                            const dist = Math.sqrt(dx * dx + dz * dz);
                                            if (dist < nearestDockDist) nearestDockDist = dist;
                                        }
                                    }
                                }
                            }
                            ui._marketDockCache = { marketId, nearestDockDist };
                        }
                        const nearestDockDist = ui._marketDockCache.nearestDockDist;

                        if (nearestDockDist <= TRADE_RANGE) {
                            tooltip += `<br><span style="color:#4a4">Ships can dock here</span>`;
                        } else if (nearestDockDist < Infinity) {
                            const unitsAway = Math.ceil(nearestDockDist - TRADE_RANGE);
                            tooltip += `<br><span class="tooltip-warning">Too far from dock for trade (${unitsAway} units)</span>`;
                        } else {
                            tooltip += `<br><span class="tooltip-warning">No dock nearby - build one for trade</span>`;
                        }
                    }

                    // Worker structures that spawn NPCs (need market within 20 units)
                    const workerStructures = ['bakery', 'gardener', 'fisherman', 'woodcutter', 'miner', 'stonemason'];
                    if (workerStructures.includes(structureType)) {
                        const structId = nearestStructure.userData?.objectId;

                        // Only calculate once per structure (buildings don't move)
                        if (!ui._workerCache || ui._workerCache.structId !== structId) {
                            let nearestMarketDist = Infinity;

                            if (window.game?.chunkManager?.chunkObjects) {
                                for (const objects of window.game.chunkManager.chunkObjects.values()) {
                                    for (const obj of objects) {
                                        if (obj.userData?.modelType === 'market') {
                                            const dx = structurePos.x - obj.position.x;
                                            const dz = structurePos.z - obj.position.z;
                                            const dist = Math.sqrt(dx * dx + dz * dz);
                                            if (dist < nearestMarketDist) nearestMarketDist = dist;
                                        }
                                    }
                                }
                            }
                            ui._workerCache = { structId, nearestMarketDist };
                        }

                        const { nearestMarketDist } = ui._workerCache;
                        const marketConnected = nearestMarketDist <= TRADE_RANGE;
                        const workerName = structureType.charAt(0).toUpperCase() + structureType.slice(1);

                        if (marketConnected) {
                            tooltip += `<br><span style="color:#4a4">Connected to market</span>`;
                            tooltip += `<br><span style="color:#4a4">${workerName} spawns when ship arrives</span>`;
                        } else if (nearestMarketDist < Infinity) {
                            const unitsAway = Math.ceil(nearestMarketDist - TRADE_RANGE);
                            tooltip += `<br><span class="tooltip-warning">Too far from market (${unitsAway} units)</span>`;
                        } else {
                            tooltip += `<br><span class="tooltip-warning">No market nearby - build one</span>`;
                        }
                    }

                    buttonTooltips.set('crateInventoryBtn', tooltip);
                }
            } else {
                crateBtn.style.display = 'none';
                buttonTooltips.delete('crateInventoryBtn');
            }
        }

        // Hide addBtn (temporarily disabled)
        if (addBtn) addBtn.style.display = 'none';

        // Determine which button to show based on the single nearest object
        const treeTypes = ['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress', 'apple'];
        const rockTypes = ['limestone', 'sandstone', 'clay', 'iron'];

        // Skip all action button display logic if mounted or manning artillery
        if (nearestObject && !isMounted && !isManningArtillery) {
            const objectType = nearestObject.name;
            const isTree = treeTypes.includes(objectType);
            const isRock = rockTypes.includes(objectType);
            const isVegetables = objectType === 'vegetables';
            const isLog = objectType === 'log' || objectType.endsWith('_log');

            // Build tooltip for natural objects
            const objectTooltip = buildObjectTooltip(nearestObject);

            // Show appropriate button based on object type
            if (isTree) {
                removeBtn.textContent = 'Chop Tree';
                const isGrowingTree = nearestObject.isGrowing;
                const canChop = isInChunk && hasAxe && !isMoving && !isGrowingTree;

                // Always show button when near tree, but grey out if can't use
                removeBtn.style.display = 'inline-block';
                removeBtn.disabled = !canChop;
                removeBtn.style.opacity = canChop ? '1' : '0.5';
                removeBtn.style.cursor = canChop ? 'pointer' : 'not-allowed';

                // Build tooltip with reason if disabled
                let tooltip = objectTooltip;
                if (!canChop) {
                    const reasons = [];
                    if (isMoving) reasons.push('Stop moving');
                    if (!hasAxe) reasons.push('Need axe');
                    if (isGrowingTree) reasons.push('Still growing');
                    if (reasons.length > 0) {
                        tooltip += `<br><span class="tooltip-warning">${reasons.join(', ')}</span>`;
                    }
                }
                buttonTooltips.set('removeBoxBtn', tooltip);

                // No saw planks button for trees
                sawPlanksBtn.style.display = 'none';
                buttonTooltips.delete('sawPlanksBtn');

                // Hide climb button when near tree
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }
            } else if (isRock) {
                const rockName = objectType.charAt(0).toUpperCase() + objectType.slice(1);
                removeBtn.textContent = `Mine ${rockName}`;
                const hasRequiredTool = nearestObject.toolCheck && nearestObject.toolCheck.hasRequiredTool;
                const hasResources = nearestObject.remainingResources > 0;
                const canMine = isInChunk && hasRequiredTool && hasResources && !isOnCooldown && !isMoving;

                // Always show button when near rock, but grey out if can't use
                removeBtn.style.display = 'inline-block';
                removeBtn.disabled = !canMine;
                removeBtn.style.opacity = canMine ? '1' : '0.5';
                removeBtn.style.cursor = canMine ? 'pointer' : 'not-allowed';

                // Build tooltip with reason if disabled
                let tooltip = objectTooltip;
                if (!canMine) {
                    const reasons = [];
                    if (isMoving) reasons.push('Stop moving');
                    if (!hasRequiredTool) reasons.push(nearestObject.toolCheck?.reason || 'Need pickaxe');
                    if (!hasResources) reasons.push('Depleted');
                    if (isOnCooldown) reasons.push('On cooldown');
                    if (reasons.length > 0) {
                        tooltip += `<br><span class="tooltip-warning">${reasons.join(', ')}</span>`;
                    }
                }
                buttonTooltips.set('removeBoxBtn', tooltip);

                // No saw planks button for rocks
                sawPlanksBtn.style.display = 'none';
                buttonTooltips.delete('sawPlanksBtn');

                // Hide climb button when near rock
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }
            } else if (isLog) {
                const hasLogResources = nearestObject.remainingResources > 0;

                // Chop Firewood button
                removeBtn.textContent = 'Chop Firewood';
                const canChopFirewood = isInChunk && hasAxe && hasLogResources && !isOnCooldown && !isMoving;

                // Always show button when near log, but grey out if can't use
                removeBtn.style.display = 'inline-block';
                removeBtn.disabled = !canChopFirewood;
                removeBtn.style.opacity = canChopFirewood ? '1' : '0.5';
                removeBtn.style.cursor = canChopFirewood ? 'pointer' : 'not-allowed';

                // Build tooltip with reason if disabled
                let firewoodTooltip = objectTooltip;
                if (!canChopFirewood) {
                    const reasons = [];
                    if (isMoving) reasons.push('Stop moving');
                    if (!hasAxe) reasons.push('Need axe');
                    if (!hasLogResources) reasons.push('Depleted');
                    if (isOnCooldown) reasons.push('On cooldown');
                    if (reasons.length > 0) {
                        firewoodTooltip += `<br><span class="tooltip-warning">${reasons.join(', ')}</span>`;
                    }
                }
                buttonTooltips.set('removeBoxBtn', firewoodTooltip);

                // Saw Planks button - only shows for logs
                sawPlanksBtn.textContent = 'Saw Planks';
                const canSawPlanks = isInChunk && hasSaw && hasLogResources && !isOnCooldown && !isMoving;

                // Always show button when near log, but grey out if can't use
                sawPlanksBtn.style.display = 'inline-block';
                sawPlanksBtn.disabled = !canSawPlanks;
                sawPlanksBtn.style.opacity = canSawPlanks ? '1' : '0.5';
                sawPlanksBtn.style.cursor = canSawPlanks ? 'pointer' : 'not-allowed';

                // Build tooltip with reason if disabled
                let sawTooltip = objectTooltip;
                if (!canSawPlanks) {
                    const reasons = [];
                    if (isMoving) reasons.push('Stop moving');
                    if (!hasSaw) reasons.push('Need saw');
                    if (!hasLogResources) reasons.push('Depleted');
                    if (isOnCooldown) reasons.push('On cooldown');
                    if (reasons.length > 0) {
                        sawTooltip += `<br><span class="tooltip-warning">${reasons.join(', ')}</span>`;
                    }
                }
                buttonTooltips.set('sawPlanksBtn', sawTooltip);

                // Hide climb button when near log
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }

            } else if (isVegetables) {
                // Vegetables use dedicated gatherVegetablesBtn, hide removeBtn
                removeBtn.style.display = 'none';
                sawPlanksBtn.style.display = 'none';
                buttonTooltips.delete('removeBoxBtn');
                buttonTooltips.delete('sawPlanksBtn');

                // Set tooltip for vegetables button
                buttonTooltips.set('gatherVegetablesBtn', objectTooltip);

                // Hide climb button when near vegetables
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }

            } else {
                // Unknown object type, hide all buttons
                removeBtn.style.display = 'none';
                sawPlanksBtn.style.display = 'none';
                buttonTooltips.delete('removeBoxBtn');
                buttonTooltips.delete('sawPlanksBtn');

                // Hide climb button when near non-structure object
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }
            }
        } else if (nearestStructure && !isMoving) {
            // Build structure tooltip
            const structureTooltip = buildStructureTooltip(nearestStructure);
            // Handle structure removal or climbing
            const structureType = nearestStructure.userData?.modelType;
            const isConstructionSite = nearestStructure.userData?.isConstructionSite;
            const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'fisherman', 'miner', 'woodcutter', 'stonemason', 'bearden', 'wall', 'artillery'];

            // Show demolish for both regular structures and construction sites
            if (structureTypes.includes(structureType) || isConstructionSite) {
                // Special handling for outposts - show Climb button instead of Demolish
                if (structureType === 'outpost') {
                    const outpostId = nearestStructure.userData?.objectId;
                    const isOccupied = occupiedOutposts && occupiedOutposts.has ? occupiedOutposts.has(outpostId) : false;

                    // Show Climb button only if outpost is not occupied AND player is not currently climbing AND not moving
                    const climbBtn = domCache.climbBtn;
                    if (climbBtn) {
                        const shouldShow = (!isOccupied && !isClimbing && !isMoving);
                        climbBtn.style.display = shouldShow ? 'inline-block' : 'none';
                    }

                    // Hide Demolish button when outpost is occupied OR when player is climbing
                    if (isOccupied) {
                        removeBtn.textContent = 'Outpost Occupied';
                        removeBtn.style.display = 'inline-block';
                        removeBtn.disabled = true;
                        removeBtn.style.opacity = '0.5';
                        removeBtn.style.cursor = 'not-allowed';
                    } else if (isClimbing) {
                        // Hide demolish button completely when player is climbing
                        removeBtn.style.display = 'none';
                    } else {
                        removeBtn.textContent = 'Demolish Outpost';
                        const canDemolish = hasHammer;
                        removeBtn.style.display = canDemolish ? 'inline-block' : 'none';
                        removeBtn.disabled = false;
                        removeBtn.style.opacity = '1';
                        removeBtn.style.cursor = 'pointer';
                    }
                    sawPlanksBtn.style.display = 'none';
                } else {
                    // Non-outpost structures: hide removeBtn (demolishStructureBtn handles this)
                    removeBtn.style.display = 'none';
                    sawPlanksBtn.style.display = 'none';
                    buttonTooltips.delete('removeBoxBtn');
                    buttonTooltips.delete('sawPlanksBtn');

                    // Hide climb button for non-outpost structures
                    const climbBtn = domCache.climbBtn;
                    if (climbBtn) {
                        climbBtn.style.display = 'none';
                    }
                }

                // Set tooltip for crate/storage button (only if not already set with special info like dock connection)
                if (!buttonTooltips.has('crateInventoryBtn')) {
                    buttonTooltips.set('crateInventoryBtn', structureTooltip);
                }
            } else {
                removeBtn.style.display = 'none';
                sawPlanksBtn.style.display = 'none';
                buttonTooltips.delete('removeBoxBtn');
                buttonTooltips.delete('sawPlanksBtn');

                // Hide climb button
                const climbBtn = domCache.climbBtn;
                if (climbBtn) {
                    climbBtn.style.display = 'none';
                }
            }
        } else {
            // No object or structure nearby, hide all buttons and clear tooltips
            removeBtn.style.display = 'none';
            sawPlanksBtn.style.display = 'none';
            buttonTooltips.delete('removeBoxBtn');
            buttonTooltips.delete('sawPlanksBtn');
            buttonTooltips.delete('crateInventoryBtn');
            buttonTooltips.delete('gatherVegetablesBtn');

            // Hide climb button when no structure nearby
            const climbBtn = domCache.climbBtn;
            if (climbBtn) {
                climbBtn.style.display = 'none';
            }
        }

        // Fishing button - show when on shore with fishing net and not already doing an action
        if (fishingBtn && !isMounted && !isManningArtillery) {
            const canFish = nearWater && hasFishingNet && !isOnCooldown && !isMoving && !activeAction;
            fishingBtn.style.display = canFish ? 'inline-block' : 'none';
        }

        // Repair Structure button - show when near a structure with hammer (Phase 2: Repair System)
        if (repairStructureBtn && !isMounted && !isManningArtillery) {
            // Only show repair for structures that can decay (not natural objects like trees)
            const structureType = nearestStructure?.userData?.modelType;
            const isConstructionSite = nearestStructure?.userData?.isConstructionSite;
            const isRepairableStructure = structureType && !isConstructionSite && (
                structureType === 'house' || structureType === 'crate' || structureType === 'tent' ||
                structureType === 'outpost' || structureType === 'ship' || structureType === 'campfire' ||
                structureType === 'garden' || structureType === 'market' || structureType === 'dock' ||
                structureType === 'bakery' || structureType === 'gardener' || structureType === 'fisherman' ||
                structureType === 'woodcutter' || structureType === 'stonemason' || structureType === 'miner' ||
                structureType === 'tileworks' || structureType === 'ironworks' || structureType === 'blacksmith' ||
                structureType === 'wall' || structureType === 'artillery'
            );
            const canRepair = nearestStructure && isRepairableStructure && hasHammer && !isMoving && !isOnCooldown;
            repairStructureBtn.style.display = canRepair ? 'inline-block' : 'none';

            // Update button text to show structure type
            if (canRepair && structureType) {
                const displayType = isConstructionSite ? 'Construction Site' :
                    structureType.charAt(0).toUpperCase() + structureType.slice(1);
                repairStructureBtn.textContent = `Repair ${displayType}`;
                // Set tooltip for repair button with tip about what it does
                buttonTooltips.set('repairStructureBtn', buildRepairTooltip(nearestStructure));
            } else {
                buttonTooltips.delete('repairStructureBtn');
            }
        }

        // Demolish Structure button - show when near a structure with hammer (separate from removeBtn for natural objects)
        if (demolishStructureBtn && !isMounted && !isManningArtillery) {
            const structureType = nearestStructure?.userData?.modelType;
            const isConstructionSite = nearestStructure?.userData?.isConstructionSite;
            const demolishableTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'fisherman', 'miner', 'woodcutter', 'stonemason', 'bearden', 'wall', 'artillery'];
            const isDemolishableStructure = (structureType && demolishableTypes.includes(structureType)) || isConstructionSite;

            if (isDemolishableStructure) {
                // Check ownership for protected structures
                const ownerProtectedStructures = ['house', 'outpost', 'market', 'garden', 'tileworks', 'dock', 'ship', 'wall', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'fisherman', 'miner', 'woodcutter', 'stonemason'];
                const isOwnerProtected = ownerProtectedStructures.includes(structureType);
                let isOwner = true;
                if (isOwnerProtected && nearestStructure.userData?.owner) {
                    if (window.game && window.game.gameState) {
                        const owner = nearestStructure.userData.owner;
                        const currentClientId = window.game.gameState.clientId;
                        const currentAccountId = window.game.gameState.accountId;
                        isOwner = (owner === currentClientId || owner === currentAccountId);
                    }
                }

                const canDemolish = hasHammer && !isMoving && (!isOwnerProtected || isOwner);
                demolishStructureBtn.style.display = canDemolish ? 'inline-block' : 'none';

                if (canDemolish) {
                    const displayType = isConstructionSite ? 'Construction Site' :
                        structureType.charAt(0).toUpperCase() + structureType.slice(1);
                    demolishStructureBtn.textContent = `Demolish ${displayType}`;
                    buttonTooltips.set('demolishStructureBtn', buildStructureTooltip(nearestStructure));
                } else {
                    buttonTooltips.delete('demolishStructureBtn');
                }
            } else {
                demolishStructureBtn.style.display = 'none';
                buttonTooltips.delete('demolishStructureBtn');
            }
        }

        // Vines gathering button - show when standing on grass terrain and not doing another action
        if (domCache.gatherVinesBtn && !isMounted && !isManningArtillery) {
            const canGatherVines = onGrass && !isOnCooldown && !isMoving && !activeAction;
            domCache.gatherVinesBtn.style.display = canGatherVines ? 'inline-block' : 'none';
        }

        // Mushroom gathering button - show when mushroom is available (10% chance when stopped on grass)
        if (domCache.gatherMushroomBtn && !isMounted && !isManningArtillery) {
            const canGatherMushroom = mushroomAvailable && !isMoving && !activeAction;
            domCache.gatherMushroomBtn.style.display = canGatherMushroom ? 'inline-block' : 'none';
        }

        // Vegetable seeds gathering button - show when vegetable seeds available (2.5% chance when stopped on grass)
        if (domCache.gatherVegetableSeedsBtn && !isMounted && !isManningArtillery) {
            const canGatherVegetableSeeds = vegetableSeedsAvailable && !isMoving && !activeAction;
            domCache.gatherVegetableSeedsBtn.style.display = canGatherVegetableSeeds ? 'inline-block' : 'none';
        }

        // Seed gathering button - show when seeds are available (20% chance when stopped near tree)
        if (domCache.gatherSeedsBtn && !isMounted && !isManningArtillery) {
            const canGatherSeeds = seedsAvailable && !isMoving && !activeAction;
            domCache.gatherSeedsBtn.style.display = canGatherSeeds ? 'inline-block' : 'none';

            // Update button text to show tree type
            if (canGatherSeeds && seedTreeType) {
                if (seedTreeType === 'vegetables') {
                    domCache.gatherSeedsBtn.textContent = 'Gather Vegetable Seeds';
                } else {
                    const capitalizedType = seedTreeType.charAt(0).toUpperCase() + seedTreeType.slice(1);
                    domCache.gatherSeedsBtn.textContent = `Gather ${capitalizedType} Seed`;
                }
            }
        }

        // Gather vegetables button - show when near vegetables object and stopped
        // Also show greyed out when near GROWING vegetables
        if (domCache.gatherVegetablesBtn && !isMounted && !isManningArtillery) {
            const isNearVegetables = nearestObject && nearestObject.name === 'vegetables';
            const isGrowingVegetables = isNearVegetables && nearestObject.isGrowing;
            const canGatherVegetables = vegetablesGatherAvailable && !isMoving && !isOnCooldown && !activeAction;

            if (isGrowingVegetables && !isMoving) {
                // Show greyed-out button for growing vegetables
                domCache.gatherVegetablesBtn.style.display = 'inline-block';
                domCache.gatherVegetablesBtn.textContent = 'Vegetables';
                domCache.gatherVegetablesBtn.disabled = true;
                domCache.gatherVegetablesBtn.style.opacity = '0.5';
                domCache.gatherVegetablesBtn.style.cursor = 'not-allowed';
                // Set tooltip showing growth progress
                const growthPercent = nearestObject.growthScale ? Math.round(nearestObject.growthScale * 100) : 0;
                buttonTooltips.set('gatherVegetablesBtn', `Vegetables<br>Growth: ${growthPercent}%<br><span class="tooltip-warning">Not Ready</span>`);
            } else if (canGatherVegetables) {
                // Show enabled button for harvestable vegetables
                domCache.gatherVegetablesBtn.style.display = 'inline-block';
                domCache.gatherVegetablesBtn.textContent = 'Gather Vegetables';
                domCache.gatherVegetablesBtn.disabled = false;
                domCache.gatherVegetablesBtn.style.opacity = '1';
                domCache.gatherVegetablesBtn.style.cursor = 'pointer';
                // Update tooltip to match current nearestObject (fixes quality mismatch)
                buttonTooltips.set('gatherVegetablesBtn', buildObjectTooltip(nearestObject));
            } else {
                domCache.gatherVegetablesBtn.style.display = 'none';
            }
        }

        // Harvest deer button - show when near dead deer corpse and stopped
        if (domCache.harvestDeerBtn && !isMounted && !isManningArtillery) {
            if (nearestDeerCorpse && !isMoving && !activeAction) {
                domCache.harvestDeerBtn.style.display = 'inline-block';
                domCache.harvestDeerBtn.disabled = false;
                domCache.harvestDeerBtn.style.opacity = '1';
                domCache.harvestDeerBtn.style.cursor = 'pointer';
                buttonTooltips.set('harvestDeerBtn', `Deer Corpse<br>Quality varies by region`);
            } else {
                domCache.harvestDeerBtn.style.display = 'none';
                buttonTooltips.delete('harvestDeerBtn');
            }
        }

        // Harvest brownbear button - show when near dead brownbear corpse and stopped
        if (domCache.harvestBrownbearBtn && !isMounted && !isManningArtillery) {
            if (nearestBrownbearCorpse && !isMoving && !activeAction) {
                domCache.harvestBrownbearBtn.style.display = 'inline-block';
                domCache.harvestBrownbearBtn.disabled = false;
                domCache.harvestBrownbearBtn.style.opacity = '1';
                domCache.harvestBrownbearBtn.style.cursor = 'pointer';
                buttonTooltips.set('harvestBrownbearBtn', `Brown Bear Corpse<br>Quality varies by region`);
            } else {
                domCache.harvestBrownbearBtn.style.display = 'none';
                buttonTooltips.delete('harvestBrownbearBtn');
            }
        }

        // Climb Down button - show only when player is climbing
        const climbDownBtn = domCache.climbDownBtn;
        if (climbDownBtn) {
            const shouldShowClimbDown = isClimbing;
            climbDownBtn.style.display = shouldShowClimbDown ? 'inline-block' : 'none';
        }

        // Create Account button - show only for guest players who have completed initial auth
        if (createAccountBtn && window.game && window.game.gameState) {
            const isGuest = window.game.gameState.isGuest;
            const hasCompleted = window.game.gameState.hasCompletedInitialAuth;
            createAccountBtn.style.display = (isGuest && hasCompleted) ? 'inline-block' : 'none';
        }

        // Mobile Entity button (Enter Boat / Mount Horse / Exit / Dismount)
        const mobileBtn = domCache.enterMobileEntityBtn;
        if (mobileBtn && !isManningArtillery) {
            const phase = mobileEntityState?.phase;
            const entityType = mobileEntityState?.entityType || nearestMobileEntity?.type;

            if (phase === 'boarding' || phase === 'disembarking') {
                // Player transitioning - hide button
                mobileBtn.style.display = 'none';
            } else if (phase === 'piloting') {
                // Piloting/Riding - show exit button only if canDisembark
                if (canDisembark) {
                    // Use entity-specific exit label
                    const config = window.game?.mobileEntitySystem?.getConfig(entityType);
                    mobileBtn.textContent = config?.exitButtonLabel ||
                        (entityType === 'horse' ? 'Dismount' : 'Exit Boat');
                    mobileBtn.style.display = 'inline-block';
                    mobileBtn.disabled = false;
                    mobileBtn.style.opacity = '1';
                    mobileBtn.style.cursor = 'pointer';
                } else {
                    // Moving or not near valid exit point - hide
                    mobileBtn.style.display = 'none';
                }
            } else if (nearestMobileEntity && !isMoving) {
                // Near a mobile entity and not moving - show Enter/Mount button
                const nearType = nearestMobileEntity.type;
                const config = window.game?.mobileEntitySystem?.getConfig(nearType);
                mobileBtn.textContent = config?.buttonLabel ||
                    (nearType === 'horse' ? 'Mount Horse' : 'Enter Boat');
                mobileBtn.style.display = 'inline-block';
                mobileBtn.disabled = false;
                mobileBtn.style.opacity = '1';
                mobileBtn.style.cursor = 'pointer';
            } else {
                // No mobile entity nearby or moving - hide
                mobileBtn.style.display = 'none';
            }
        }

        // Cart/Artillery state (needed for canMan check later)
        const isCartAttached = cartAttachmentState?.isAttached;
        const isArtilleryAttached = artilleryAttachmentState?.isAttached;

        // Cart/Artillery buttons (Attach/Release for towable entities)
        // Hide when manning artillery
        if (!isManningArtillery) {
        const attachCartBtn = domCache.attachCartBtn;
        const releaseCartBtn = domCache.releaseCartBtn;
        const isMountedOnHorse = mobileEntityState?.isActive &&
            mobileEntityState?.phase === 'piloting' &&
            mobileEntityState?.entityType === 'horse';

        if (attachCartBtn) {
            // Show attach button when near a towable entity and not currently towing one
            const isValidCart = nearestTowableEntity && nearestTowableEntity.type === 'cart' && nearestTowableEntity.object;
            const isValidArtillery = nearestTowableEntity && nearestTowableEntity.type === 'artillery' && nearestTowableEntity.object;
            // Cart can be attached on foot or mounted; Artillery requires horse
            const canAttachCart = isValidCart && !isMoving && !isCartAttached && !isArtilleryAttached;
            const canAttachArtillery = isValidArtillery && isMountedOnHorse && !isMoving && !isCartAttached && !isArtilleryAttached;

            if (canAttachCart || canAttachArtillery) {
                const entityLabel = isValidArtillery ? 'Artillery' : 'Cart';
                attachCartBtn.textContent = `Attach ${entityLabel}`;
                attachCartBtn.style.display = 'inline-block';
                attachCartBtn.disabled = false;
                attachCartBtn.style.opacity = '1';
                attachCartBtn.style.cursor = 'pointer';
            } else {
                attachCartBtn.style.display = 'none';
            }
        }

        if (releaseCartBtn) {
            // Show release button when currently towing a cart or artillery
            if (isCartAttached || isArtilleryAttached) {
                const entityLabel = isArtilleryAttached ? 'Artillery' : 'Cart';
                releaseCartBtn.textContent = `Release ${entityLabel}`;
                releaseCartBtn.style.display = 'inline-block';
                releaseCartBtn.disabled = false;
                releaseCartBtn.style.opacity = '1';
                releaseCartBtn.style.cursor = 'pointer';
            } else {
                releaseCartBtn.style.display = 'none';
            }
        }

        // Crate loading buttons (Load Crate / Unload Crate) - Cart only, not artillery
        const loadCrateBtn = domCache.loadCrateBtn;
        const unloadCrateBtn = domCache.unloadCrateBtn;
        const isCrateLoaded = crateLoadState?.isLoaded;

        if (loadCrateBtn) {
            // Show load button when:
            // 1. Player has CART attached (not artillery)
            // 2. No crate currently loaded (!isCrateLoaded)
            // 3. Near a crate (nearestLoadableCrate)
            // 4. Not moving (!isMoving)
            const canLoadCrate = isCartAttached && !isCrateLoaded &&
                nearestLoadableCrate && nearestLoadableCrate.object && !isMoving;
            if (canLoadCrate) {
                loadCrateBtn.style.display = 'inline-block';
                loadCrateBtn.disabled = false;
                loadCrateBtn.style.opacity = '1';
                loadCrateBtn.style.cursor = 'pointer';
            } else {
                loadCrateBtn.style.display = 'none';
            }
        }

        if (unloadCrateBtn) {
            // Show unload button when:
            // 1. Player has CART attached (not artillery)
            // 2. Crate is loaded (isCrateLoaded)
            // 3. Not moving (!isMoving)
            const canUnloadCrate = isCartAttached && isCrateLoaded && !isMoving;
            if (canUnloadCrate) {
                unloadCrateBtn.style.display = 'inline-block';
                unloadCrateBtn.disabled = false;
                unloadCrateBtn.style.opacity = '1';
                unloadCrateBtn.style.cursor = 'pointer';
            } else {
                unloadCrateBtn.style.display = 'none';
            }
        }
        } // End of !isManningArtillery block for cart/crate buttons

        // Artillery manning buttons (Man Artillery / Leave Artillery)
        const manArtilleryBtn = domCache.manArtilleryBtn;
        const leaveArtilleryBtn = domCache.leaveArtilleryBtn;
        // Note: isManningArtillery is already defined earlier in this function

        if (manArtilleryBtn) {
            // Show "Man Artillery" when:
            // 1. Near a mannable artillery (!nearestMannableArtillery.occupied)
            // 2. Not currently manning (!isManningArtillery)
            // 3. Not moving (!isMoving)
            // 4. Not mounted on horse (!isMounted)
            // 5. Not towing cart or artillery (!isCartAttached && !isArtilleryAttached)
            const canMan = nearestMannableArtillery &&
                nearestMannableArtillery.object &&
                !nearestMannableArtillery.occupied &&
                !isManningArtillery &&
                !isMoving &&
                !isMounted &&
                !isCartAttached &&
                !isArtilleryAttached;

            if (canMan) {
                manArtilleryBtn.style.display = 'inline-block';
                manArtilleryBtn.disabled = false;
                manArtilleryBtn.style.opacity = '1';
                manArtilleryBtn.style.cursor = 'pointer';
            } else {
                manArtilleryBtn.style.display = 'none';
            }
        }

        if (leaveArtilleryBtn) {
            // Show "Leave Artillery" when currently manning
            if (isManningArtillery) {
                leaveArtilleryBtn.style.display = 'inline-block';
                leaveArtilleryBtn.disabled = false;
                leaveArtilleryBtn.style.opacity = '1';
                leaveArtilleryBtn.style.cursor = 'pointer';
            } else {
                leaveArtilleryBtn.style.display = 'none';
            }
        }

        // Fire button - show when manning, with cooldown state
        const fireArtilleryBtn = domCache.fireArtilleryBtn;
        if (fireArtilleryBtn) {
            if (isManningArtillery) {
                fireArtilleryBtn.style.display = 'inline-block';
                // Check cooldown (12 seconds)
                const now = Date.now();
                const lastFireTime = artilleryManningState?.lastFireTime || 0;
                const cooldown = 12000;
                const isOnFireCooldown = (now - lastFireTime) < cooldown;

                if (isOnFireCooldown) {
                    const remaining = Math.ceil((cooldown - (now - lastFireTime)) / 1000);
                    fireArtilleryBtn.textContent = `Fire (${remaining}s)`;
                    fireArtilleryBtn.disabled = true;
                    fireArtilleryBtn.style.opacity = '0.5';
                    fireArtilleryBtn.style.cursor = 'not-allowed';
                } else {
                    fireArtilleryBtn.textContent = 'Fire';
                    fireArtilleryBtn.disabled = false;
                    fireArtilleryBtn.style.opacity = '1';
                    fireArtilleryBtn.style.cursor = 'pointer';
                }
            } else {
                fireArtilleryBtn.style.display = 'none';
            }
        }

        // Refresh tooltip if still hovering over a button (data may have changed)
        if (hoveredButton && domCache.actionTooltip) {
            const tooltipText = buttonTooltips.get(hoveredButton);
            if (tooltipText) {
                domCache.actionTooltip.innerHTML = tooltipText;
            } else {
                domCache.actionTooltip.style.display = 'none';
            }
        }
    },

    // Show/hide the merchant talk button
    updateMerchantButton(nearMerchant, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkMerchantBtn;
        if (btn) {
            const shouldShow = nearMerchant && !isMoving;
            if (buttonStateCache.merchantBtn !== shouldShow) {
                buttonStateCache.merchantBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show the merchant dialogue modal with text
    showMerchantDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.merchantDialogueModal;
        const textEl = domCache.merchantDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide the merchant dialogue modal
    hideMerchantDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.merchantDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup merchant dialogue close button (called once during init)
    setupMerchantDialogue() {
        if (!domCache.initialized) initDOMCache();

        const closeBtn = domCache.merchantDialogueClose;
        const modal = domCache.merchantDialogueModal;

        if (closeBtn) {
            closeBtn.onclick = () => {
                if (modal) modal.style.display = 'none';
            };
        }

        // Also close when clicking outside the dialogue content
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            };
        }
    },

    // Show/hide the trapper button
    updateTrapperButton(nearTrapper, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkTrapperBtn;
        if (btn) {
            const shouldShow = nearTrapper && !isMoving;
            if (buttonStateCache.trapperBtn !== shouldShow) {
                buttonStateCache.trapperBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the baker button
    updateBakerButton(nearBaker, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkBakerBtn;
        if (btn) {
            const shouldShow = nearBaker && !isMoving;
            if (buttonStateCache.bakerBtn !== shouldShow) {
                buttonStateCache.bakerBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the gardener button
    updateGardenerButton(nearGardener, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkGardenerBtn;
        if (btn) {
            const shouldShow = nearGardener && !isMoving;
            if (buttonStateCache.gardenerBtn !== shouldShow) {
                buttonStateCache.gardenerBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the woodcutter button
    updateWoodcutterButton(nearWoodcutter, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkWoodcutterBtn;
        if (btn) {
            const shouldShow = nearWoodcutter && !isMoving;
            if (buttonStateCache.woodcutterBtn !== shouldShow) {
                buttonStateCache.woodcutterBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the miner button
    updateMinerButton(nearMiner, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkMinerBtn;
        if (btn) {
            const shouldShow = nearMiner && !isMoving;
            if (buttonStateCache.minerBtn !== shouldShow) {
                buttonStateCache.minerBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the fisherman button
    updateFishermanButton(nearFisherman, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkFishermanBtn;
        if (btn) {
            const shouldShow = nearFisherman && !isMoving;
            if (buttonStateCache.fishermanBtn !== shouldShow) {
                buttonStateCache.fishermanBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the blacksmith button
    updateBlacksmithButton(nearBlacksmith, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkBlacksmithBtn;
        if (btn) {
            const shouldShow = nearBlacksmith && !isMoving;
            if (buttonStateCache.blacksmithBtn !== shouldShow) {
                buttonStateCache.blacksmithBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the iron worker button
    updateIronWorkerButton(nearIronWorker, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkIronWorkerBtn;
        if (btn) {
            const shouldShow = nearIronWorker && !isMoving;
            if (buttonStateCache.ironWorkerBtn !== shouldShow) {
                buttonStateCache.ironWorkerBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the tile worker button
    updateTileWorkerButton(nearTileWorker, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkTileWorkerBtn;
        if (btn) {
            const shouldShow = nearTileWorker && !isMoving;
            if (buttonStateCache.tileWorkerBtn !== shouldShow) {
                buttonStateCache.tileWorkerBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show/hide the stone mason button
    updateStoneMasonButton(nearStoneMason, isMoving = false) {
        if (!domCache.initialized) initDOMCache();

        const btn = domCache.talkStoneMasonBtn;
        if (btn) {
            const shouldShow = nearStoneMason && !isMoving;
            if (buttonStateCache.stoneMasonBtn !== shouldShow) {
                buttonStateCache.stoneMasonBtn = shouldShow;
                btn.style.display = shouldShow ? 'inline-block' : 'none';
            }
        }
    },

    // Show the trapper dialogue modal
    showTrapperDialogue(dialogueText, canAfford, coinCount) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.trapperDialogueModal;
        const textEl = domCache.trapperDialogueText;
        const resourceList = domCache.trapperResourceList;
        const payBtn = domCache.trapperPayBtn;
        const noBtn = domCache.trapperNoBtn;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';

            // Reset resource list
            if (resourceList) {
                resourceList.style.display = 'none';
                resourceList.innerHTML = '';
            }

            // Configure pay button
            if (payBtn) {
                payBtn.disabled = !canAfford;
                payBtn.title = canAfford ? '' : `You need 5 coins (you have ${coinCount})`;
                payBtn.style.display = 'inline-block';
            }

            // Reset no button text
            if (noBtn) {
                noBtn.textContent = 'No';
            }
        }
    },

    // Show the resource info after payment
    showTrapperResourceInfo(resourceInfo) {
        if (!domCache.initialized) initDOMCache();

        const resourceList = domCache.trapperResourceList;
        const payBtn = domCache.trapperPayBtn;
        const noBtn = domCache.trapperNoBtn;
        const textEl = domCache.trapperDialogueText;

        if (resourceList && Array.isArray(resourceInfo)) {
            // Build resource list HTML
            resourceList.innerHTML = resourceInfo.map(r =>
                `<div class="trapper-resource-item">
                    <span class="trapper-resource-name">${r.displayName}</span>
                    <span class="trapper-resource-quality">${r.range.name} (${r.range.min}-${r.range.max})</span>
                </div>`
            ).join('');
            resourceList.style.display = 'block';

            // Update dialogue text
            if (textEl) {
                textEl.textContent = 'Here is what I know about this region:';
            }

            // Hide pay button, change no button to close
            if (payBtn) {
                payBtn.style.display = 'none';
            }
            if (noBtn) {
                noBtn.textContent = 'Close';
            }
        }
    },

    // Hide the trapper dialogue modal
    hideTrapperDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.trapperDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup trapper dialogue buttons (called once during init)
    setupTrapperDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const payBtn = domCache.trapperPayBtn;
        const noBtn = domCache.trapperNoBtn;
        const modal = domCache.trapperDialogueModal;

        if (payBtn && callbacks?.onTrapperPay) {
            payBtn.onclick = () => {
                callbacks.onTrapperPay();
            };
        }

        if (noBtn && callbacks?.onTrapperNo) {
            noBtn.onclick = () => {
                callbacks.onTrapperNo();
            };
        }

        // Also close when clicking outside the dialogue content
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onTrapperNo) {
                    callbacks.onTrapperNo();
                }
            };
        }
    },

    // Show the baker dialogue modal with status message
    showBakerDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.bakerDialogueModal;
        const textEl = domCache.bakerDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide baker dialogue
    hideBakerDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.bakerDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup baker dialogue button (called once during init)
    setupBakerDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.bakerDismissBtn;
        const modal = domCache.bakerDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the gardener dialogue modal with status message
    showGardenerDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.gardenerDialogueModal;
        const textEl = domCache.gardenerDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide gardener dialogue
    hideGardenerDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.gardenerDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Show the woodcutter dialogue modal with status message
    showWoodcutterDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.woodcutterDialogueModal;
        const textEl = domCache.woodcutterDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide woodcutter dialogue
    hideWoodcutterDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.woodcutterDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup gardener dialogue button (called once during init)
    setupGardenerDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.gardenerDismissBtn;
        const modal = domCache.gardenerDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Setup woodcutter dialogue button (called once during init)
    setupWoodcutterDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.woodcutterDismissBtn;
        const modal = domCache.woodcutterDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the miner dialogue modal with status message
    showMinerDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.minerDialogueModal;
        const textEl = domCache.minerDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide miner dialogue
    hideMinerDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.minerDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup miner dialogue button (called once during init)
    setupMinerDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.minerDismissBtn;
        const modal = domCache.minerDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the fisherman dialogue modal with status message
    showFishermanDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.fishermanDialogueModal;
        const textEl = domCache.fishermanDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide fisherman dialogue
    hideFishermanDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.fishermanDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup fisherman dialogue button (called once during init)
    setupFishermanDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.fishermanDismissBtn;
        const modal = domCache.fishermanDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the blacksmith dialogue modal with status message
    showBlacksmithDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.blacksmithDialogueModal;
        const textEl = domCache.blacksmithDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide blacksmith dialogue
    hideBlacksmithDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.blacksmithDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup blacksmith dialogue button (called once during init)
    setupBlacksmithDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.blacksmithDismissBtn;
        const modal = domCache.blacksmithDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the iron worker dialogue modal with status message
    showIronWorkerDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.ironWorkerDialogueModal;
        const textEl = domCache.ironWorkerDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide iron worker dialogue
    hideIronWorkerDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.ironWorkerDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup iron worker dialogue button (called once during init)
    setupIronWorkerDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.ironWorkerDismissBtn;
        const modal = domCache.ironWorkerDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the tile worker dialogue modal with status message
    showTileWorkerDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.tileWorkerDialogueModal;
        const textEl = domCache.tileWorkerDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide tile worker dialogue
    hideTileWorkerDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.tileWorkerDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup tile worker dialogue button (called once during init)
    setupTileWorkerDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.tileWorkerDismissBtn;
        const modal = domCache.tileWorkerDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    // Show the stone mason dialogue modal with status message
    showStoneMasonDialogue(dialogueText) {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.stoneMasonDialogueModal;
        const textEl = domCache.stoneMasonDialogueText;

        if (modal && textEl) {
            textEl.textContent = dialogueText;
            modal.style.display = 'flex';
        }
    },

    // Hide stone mason dialogue
    hideStoneMasonDialogue() {
        if (!domCache.initialized) initDOMCache();

        const modal = domCache.stoneMasonDialogueModal;
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Setup stone mason dialogue button (called once during init)
    setupStoneMasonDialogue(callbacks) {
        if (!domCache.initialized) initDOMCache();

        const dismissBtn = domCache.stoneMasonDismissBtn;
        const modal = domCache.stoneMasonDialogueModal;

        if (dismissBtn && callbacks?.onDismiss) {
            dismissBtn.onclick = () => {
                callbacks.onDismiss();
            };
        }

        // Close when clicking outside
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal && callbacks?.onDismiss) {
                    callbacks.onDismiss();
                }
            };
        }
    },

    updateFPS(fps) {
        if (!fpsCounterEl) return;
        const color = fps >= 50 ? '#7A9060' : fps >= 30 ? '#B89F5C' : '#8B5A5A';
        fpsCounterEl.style.color = color;
        fpsCounterEl.textContent = `FPS: ${fps}`;
    },

    updatePhysicsStats(stats) {
        if (!physicsStatsEl) return;
        if (!stats) {
            physicsStatsEl.textContent = '';
            physicsStatsEl.style.display = 'none';
            return;
        }
        const total = stats.totalPhysicsObjects || 0;
        const color = total < 100 ? '#7A9060' : total < 200 ? '#B89F5C' : '#8B5A5A';
        physicsStatsEl.style.color = color;
        physicsStatsEl.textContent = `Physics: ${total} (${stats.rigidBodies}rb ${stats.characterControllers}cc)`;
        physicsStatsEl.style.display = 'block';
    },

    updatePlayerSpeed(speedData, isMoving) {
        if (!domCache.initialized) initDOMCache();
        const speedLineEl = domCache.playerSpeedLine;
        if (!speedLineEl) return;

        // Show "Stopped" when not moving
        if (!isMoving) {
            speedLineEl.textContent = 'Speed: Stopped';
            return;
        }

        const multiplier = speedData?.multiplier || 1.0;
        const percentage = Math.round(multiplier * 100);

        // Calculate slope penalty (surface penalties removed)
        const slopePenalty = speedData?.slopeMultiplier !== undefined ? Math.round((1 - speedData.slopeMultiplier) * 100) : 0;

        // Build display text
        let text = `Speed: ${percentage}%`;
        if (slopePenalty > 0) {
            text += ` | Incline: -${slopePenalty}%`;
        }
        if (speedData?.onRoad) {
            text += ' | Road: Yes';
        }

        speedLineEl.textContent = text;
    },

    updatePlayerPosition(x, y, z) {
        if (!domCache.initialized) initDOMCache();
        const posLineEl = domCache.playerPositionLine;
        if (!posLineEl) return;

        if (x === undefined || y === undefined || z === undefined) {
            return;
        }

        posLineEl.textContent = `Position: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    },

    updatePlayerRegion(chunkX, chunkZ) {
        if (!domCache.initialized) initDOMCache();
        const regionLineEl = domCache.playerRegionLine;
        if (!regionLineEl) return;

        if (chunkX === undefined || chunkZ === undefined) {
            return;
        }

        regionLineEl.textContent = `Region: ${chunkX}, ${chunkZ}`;
    },

    /**
     * Update food status display
     * @param {number} timeRemaining - Time remaining in minutes (null to hide)
     * @param {number} varietyBonus - Variety bonus percentage (0-40)
     * @param {number} foodCount - Number of food items
     * @param {string} hungerState - Current hunger state ('fed', 'hungry', 'starving')
     * @param {number} timeUntilDeath - Seconds until death from starvation (null if not applicable)
     */
    // Track previous hunger state for flash animation
    _lastHungerState: 'fed',
    _flashEndTime: 0,

    updateFoodStatus(timeRemaining, varietyBonus = 0, foodCount = 0, hungerState = 'fed', timeUntilDeath = null) {
        if (!domCache.initialized) initDOMCache();
        const foodLineEl = domCache.foodStatusLine;
        if (!foodLineEl) return;

        const now = Date.now();

        if (timeRemaining === null || foodCount === 0) {
            // Check if state just changed to hungry/starving (trigger flash)
            const stateChanged = (hungerState === 'hungry' || hungerState === 'starving') &&
                                 this._lastHungerState !== hungerState;

            // Determine if we should show flash (new state change) or static urgent
            const isFlashing = now < this._flashEndTime;
            let useFlashClass = false;

            if (stateChanged) {
                // Start flash animation (3 flashes at 0.4s each = 1.2s)
                this._flashEndTime = now + 1200;
                useFlashClass = true;
            } else if (isFlashing) {
                useFlashClass = true;
            }

            // Show hunger state when no food
            const targetClass = useFlashClass ? 'urgent-flash' : 'urgent';

            if (hungerState === 'starving' && timeUntilDeath !== null) {
                const seconds = timeUntilDeath % 60;
                const minutes = Math.floor(timeUntilDeath / 60);
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                foodLineEl.textContent = `STARVING! Death in ${timeStr}`;
                // Only change class if different (avoid restarting animation)
                if (foodLineEl.className !== targetClass) {
                    foodLineEl.className = targetClass;
                }
            } else if (hungerState === 'hungry' && timeUntilDeath !== null) {
                const minutes = Math.floor(timeUntilDeath / 60);
                const seconds = timeUntilDeath % 60;
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                foodLineEl.textContent = `HUNGRY! Death in ${timeStr}`;
                // Only change class if different (avoid restarting animation)
                if (foodLineEl.className !== targetClass) {
                    foodLineEl.className = targetClass;
                }
            } else {
                foodLineEl.textContent = 'No food!';
                if (foodLineEl.className !== 'critical') {
                    foodLineEl.className = 'critical';
                }
            }

            this._lastHungerState = hungerState;
            return;
        }

        this._lastHungerState = hungerState;

        // Format time
        let timeText;
        if (timeRemaining >= 60) {
            const hours = Math.floor(timeRemaining / 60);
            const mins = Math.floor(timeRemaining % 60);
            timeText = `${hours}h ${mins}m`;
        } else {
            timeText = `${Math.floor(timeRemaining)}m`;
        }

        // Build display text
        let text = `Food will last: ${timeText}`;
        if (varietyBonus > 0) {
            text += `\n(+${varietyBonus}% for variety)`;
        }

        foodLineEl.textContent = text;

        // Set color based on time remaining
        if (timeRemaining < 5) {
            foodLineEl.className = 'critical';
        } else if (timeRemaining < 15) {
            foodLineEl.className = 'warning';
        } else {
            foodLineEl.className = '';
        }
    },

    // Track inventory full state for flash animation
    _lastInventoryFull: false,
    _inventoryFlashEndTime: 0,

    /**
     * Update inventory full status display
     * @param {boolean} isFull - Whether inventory is completely full
     */
    updateInventoryFullStatus(isFull) {
        if (!domCache.initialized) initDOMCache();
        const invLineEl = domCache.inventoryStatusLine;
        if (!invLineEl) return;

        const now = Date.now();

        if (!isFull) {
            // Inventory has space - hide the warning
            invLineEl.className = '';
            this._lastInventoryFull = false;
            return;
        }

        // Inventory is full
        const justBecameFull = !this._lastInventoryFull;
        const isFlashing = now < this._inventoryFlashEndTime;

        let useFlashClass = false;
        if (justBecameFull) {
            // Start flash animation (3 flashes at 0.4s each = 1.2s)
            this._inventoryFlashEndTime = now + 1200;
            useFlashClass = true;
        } else if (isFlashing) {
            useFlashClass = true;
        }

        const targetClass = useFlashClass ? 'full-flash' : 'full';
        if (invLineEl.className !== targetClass) {
            invLineEl.className = targetClass;
        }

        this._lastInventoryFull = true;
    },

    /**
     * Update spawn immunity indicator
     * Shows remaining time of spawn protection against bandits/bears
     * @param {number|null} endTime - Timestamp when immunity ends (null to hide)
     */
    updateSpawnImmunity(endTime) {
        if (!domCache.initialized) initDOMCache();
        const immunityEl = domCache.spawnImmunityLine;
        if (!immunityEl) return;

        const now = Date.now();

        if (!endTime || now >= endTime) {
            // Immunity expired or not set - hide indicator
            immunityEl.style.display = 'none';
            return;
        }

        // Calculate remaining time
        const remainingMs = endTime - now;
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        // Show indicator
        immunityEl.style.display = 'block';
        immunityEl.textContent = `Protected: ${remainingSeconds}s`;
    },

    /**
     * Update placement status display (for structure placement feedback)
     * @param {string|null} message - Message to display (null to hide)
     * @param {boolean} isValid - Whether placement is valid (affects color)
     */
    updatePlacementStatus(message, isValid = true) {
        if (!domCache.initialized) initDOMCache();
        const placementEl = domCache.placementStatus;
        if (!placementEl) return;

        if (message === null) {
            placementEl.style.display = 'none';
            placementEl.textContent = '';
            return;
        }

        placementEl.textContent = message;
        placementEl.style.display = 'block';
        placementEl.className = isValid ? '' : 'invalid';
    },

    updateActionStatus(message, duration = 3000) {
        let statusEl = document.getElementById('actionStatus');

        if (!message) {
            // Hide status
            if (statusEl) {
                statusEl.remove();
            }
            return;
        }

        // Create or update status element
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'actionStatus';
            statusEl.style.cssText = `
                position: fixed;
                bottom: 40px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(42, 37, 32, 0.85);
                color: #FFD700;
                padding: 8px 16px;
                border-radius: 5px;
                font-family: monospace;
                font-size: 14px;
                z-index: 1000;
            `;
            document.body.appendChild(statusEl);
        }

        statusEl.textContent = message;

        // Clear any existing timer
        if (statusEl.hideTimer) {
            clearTimeout(statusEl.hideTimer);
        }

        // Auto-hide after duration (0 = don't hide)
        if (duration > 0) {
            statusEl.hideTimer = setTimeout(() => {
                if (statusEl && statusEl.parentNode) {
                    statusEl.remove();
                }
            }, duration);
        }
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
        repairStructureBtn = document.getElementById('repairStructureBtn');
        demolishStructureBtn = document.getElementById('demolishStructureBtn');
        inventoryToggleBtn = document.getElementById('inventoryToggleBtn');

        // Helper to wrap callbacks with audio resume (reduces duplication)
        const withAudioResume = (callback) => () => {
            if (callbacks.resumeAudio) callbacks.resumeAudio();
            callback();
        };

        // Helper to setup button event listeners
        const setupButton = (element, callback) => {
            if (element) {
                element.onclick = withAudioResume(callback);
            }
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

        setupButton(repairStructureBtn, () => {
            callbacks.onRepairStructure();
        });

        setupButton(demolishStructureBtn, () => {
            const target = callbacks.getNearestStructure();
            if (target) callbacks.onRemoveObject(target);
        });

        setupButton(document.getElementById('gatherVinesBtn'), () => {
            callbacks.onStartGatherVines();
        });

        setupButton(document.getElementById('gatherMushroomBtn'), () => {
            callbacks.onGatherMushroom();
        });

        setupButton(document.getElementById('gatherVegetableSeedsBtn'), () => {
            callbacks.onGatherVegetableSeeds();
        });

        setupButton(document.getElementById('gatherSeedsBtn'), () => {
            callbacks.onGatherSeeds();
        });

        setupButton(document.getElementById('gatherVegetablesBtn'), () => {
            callbacks.onGatherVegetables();
        });

        setupButton(document.getElementById('harvestDeerBtn'), () => {
            if (callbacks.onHarvestDeer) {
                callbacks.onHarvestDeer();
            }
        });

        setupButton(document.getElementById('harvestBrownbearBtn'), () => {
            if (callbacks.onHarvestBrownbear) {
                callbacks.onHarvestBrownbear();
            }
        });

        setupButton(document.getElementById('climbBtn'), () => {
            if (callbacks.onClimb) {
                callbacks.onClimb();
            }
        });

        setupButton(document.getElementById('climbDownBtn'), () => {
            if (callbacks.onClimbDown) {
                callbacks.onClimbDown();
            }
        });

        // Mobile entity button (Enter/Exit Boat)
        setupButton(document.getElementById('enterMobileEntityBtn'), () => {
            if (callbacks.onMobileEntityAction) {
                callbacks.onMobileEntityAction();
            }
        });

        // Cart buttons
        setupButton(document.getElementById('attachCartBtn'), () => {
            if (callbacks.onAttachCart) {
                callbacks.onAttachCart();
            }
        });

        setupButton(document.getElementById('releaseCartBtn'), () => {
            if (callbacks.onReleaseCart) {
                callbacks.onReleaseCart();
            }
        });

        // Crate loading buttons (require cart to be attached)
        setupButton(document.getElementById('loadCrateBtn'), () => {
            if (callbacks.onLoadCrate) {
                callbacks.onLoadCrate();
            }
        });

        setupButton(document.getElementById('unloadCrateBtn'), () => {
            if (callbacks.onUnloadCrate) {
                callbacks.onUnloadCrate();
            }
        });

        // Artillery manning buttons
        setupButton(document.getElementById('manArtilleryBtn'), () => {
            if (callbacks.onManArtillery) {
                callbacks.onManArtillery();
            }
        });

        setupButton(document.getElementById('leaveArtilleryBtn'), () => {
            if (callbacks.onLeaveArtillery) {
                callbacks.onLeaveArtillery();
            }
        });

        setupButton(document.getElementById('fireArtilleryBtn'), () => {
            if (callbacks.onFireArtillery) {
                callbacks.onFireArtillery();
            }
        });

        // Merchant talk button
        setupButton(document.getElementById('talkMerchantBtn'), () => {
            if (callbacks.onTalkToMerchant) {
                callbacks.onTalkToMerchant();
            }
        });

        // Setup merchant dialogue close button
        this.setupMerchantDialogue();

        // Trapper talk button
        setupButton(document.getElementById('talkTrapperBtn'), () => {
            if (callbacks.onTalkToTrapper) {
                callbacks.onTalkToTrapper();
            }
        });

        // Setup trapper dialogue buttons
        this.setupTrapperDialogue(callbacks);

        // Baker talk button
        setupButton(document.getElementById('talkBakerBtn'), () => {
            if (callbacks.onTalkToBaker) {
                callbacks.onTalkToBaker();
            }
        });

        // Setup baker dialogue buttons
        this.setupBakerDialogue({
            onDismiss: callbacks.onBakerDismiss
        });

        // Gardener talk button
        setupButton(document.getElementById('talkGardenerBtn'), () => {
            if (callbacks.onTalkToGardener) {
                callbacks.onTalkToGardener();
            }
        });

        // Setup gardener dialogue buttons
        this.setupGardenerDialogue({
            onDismiss: callbacks.onGardenerDismiss
        });

        // Woodcutter talk button
        setupButton(document.getElementById('talkWoodcutterBtn'), () => {
            if (callbacks.onTalkToWoodcutter) {
                callbacks.onTalkToWoodcutter();
            }
        });

        // Setup woodcutter dialogue buttons
        this.setupWoodcutterDialogue({
            onDismiss: callbacks.onWoodcutterDismiss
        });

        // Miner talk button
        setupButton(document.getElementById('talkMinerBtn'), () => {
            if (callbacks.onTalkToMiner) {
                callbacks.onTalkToMiner();
            }
        });

        // Setup miner dialogue buttons
        this.setupMinerDialogue({
            onDismiss: callbacks.onMinerDismiss
        });

        // Fisherman talk button
        setupButton(document.getElementById('talkFishermanBtn'), () => {
            if (callbacks.onTalkToFisherman) {
                callbacks.onTalkToFisherman();
            }
        });

        // Setup fisherman dialogue buttons
        this.setupFishermanDialogue({
            onDismiss: callbacks.onFishermanDismiss
        });

        // Blacksmith talk button
        setupButton(document.getElementById('talkBlacksmithBtn'), () => {
            if (callbacks.onTalkToBlacksmith) {
                callbacks.onTalkToBlacksmith();
            }
        });

        // Setup blacksmith dialogue buttons
        this.setupBlacksmithDialogue({
            onDismiss: callbacks.onBlacksmithDismiss
        });

        // Iron Worker talk button
        setupButton(document.getElementById('talkIronWorkerBtn'), () => {
            if (callbacks.onTalkToIronWorker) {
                callbacks.onTalkToIronWorker();
            }
        });

        // Setup iron worker dialogue buttons
        this.setupIronWorkerDialogue({
            onDismiss: callbacks.onIronWorkerDismiss
        });

        // Tile Worker talk button
        setupButton(document.getElementById('talkTileWorkerBtn'), () => {
            if (callbacks.onTalkToTileWorker) {
                callbacks.onTalkToTileWorker();
            }
        });

        // Setup tile worker dialogue buttons
        this.setupTileWorkerDialogue({
            onDismiss: callbacks.onTileWorkerDismiss
        });

        // Stone Mason talk button
        setupButton(document.getElementById('talkStoneMasonBtn'), () => {
            if (callbacks.onTalkToStoneMason) {
                callbacks.onTalkToStoneMason();
            }
        });

        // Setup stone mason dialogue buttons
        this.setupStoneMasonDialogue({
            onDismiss: callbacks.onStoneMasonDismiss
        });

        setupButton(document.getElementById('settingsToggleBtn'), () => callbacks.toggleSettings());
        setupButton(inventoryToggleBtn, () => callbacks.toggleInventory());
        setupButton(document.getElementById('buildMenuToggleBtn'), () => callbacks.toggleBuildMenu());
        setupButton(document.getElementById('constructionInventoryBtn'), () => callbacks.toggleInventory());
        setupButton(document.getElementById('crateInventoryBtn'), () => callbacks.toggleInventory());
        setupButton(document.getElementById('constructionBuildBtn'), () => callbacks.onBuildConstruction());

        createAccountBtn = document.getElementById('createAccountBtn');
        setupButton(createAccountBtn, () => {
            if (window.game && window.game.loginModal) {
                // Notify tasks panel
                if (window.tasksPanel) {
                    window.tasksPanel.onCreateAccountClicked();
                }
                window.game.loginModal.show();
                window.game.loginModal.showView('register');
            }
        });

        // Setup hover tooltips for action buttons
        setupButtonTooltip(removeBtn);
        setupButtonTooltip(sawPlanksBtn);
        setupButtonTooltip(repairStructureBtn);
        setupButtonTooltip(demolishStructureBtn);
        setupButtonTooltip(document.getElementById('crateInventoryBtn'));
        setupButtonTooltip(document.getElementById('constructionInventoryBtn'));
        setupButtonTooltip(document.getElementById('gatherVegetablesBtn'));
        setupButtonTooltip(document.getElementById('harvestDeerBtn'));
        setupButtonTooltip(document.getElementById('harvestBrownbearBtn'));
        setupButtonTooltip(document.getElementById('gatherVinesBtn'));
        setupButtonTooltip(document.getElementById('gatherMushroomBtn'));
        setupButtonTooltip(document.getElementById('gatherSeedsBtn'));
        setupButtonTooltip(document.getElementById('fishingBtn'));
        setupButtonTooltip(document.getElementById('climbBtn'));

        window.addEventListener('resize', () => {
            callbacks.onResize();
        });
    }
};
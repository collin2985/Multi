// File: server.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\server.js

const WebSocket = require('ws');
const fs = require('fs');

// Create a new WebSocket server on port 8080
const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

// A simple in-memory cache to hold our chunk data
const chunkCache = new Map();
// A map to store client data with WebSocket, currentChunk, and lastChunk
const clients = new Map();

// Define a global terrain seed (can be fixed or dynamically generated)
const terrainSeed = 12345; // Example: Random seed per server start

// Queue for rate-limiting notifications
const notificationQueue = [];
const notificationInterval = 100; // Process every 100ms

// Save the chunk state to its file
function saveChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        const filePath = `./public/${chunkId}.JSON`;
        const chunkData = chunkCache.get(chunkId);
        fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
        console.log(`Saved chunk: ${chunkId}`);
    }
}

// Load a chunk from file
function loadChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        return chunkCache.get(chunkId);
    }
    
    const filePath = `./public/${chunkId}.JSON`;
    
    try {
        const fileData = fs.readFileSync(filePath, 'utf8');
        const chunkData = JSON.parse(fileData);
        chunkCache.set(chunkId, chunkData);
        console.log(`Loaded chunk: ${chunkId}`);
        return chunkData;
    } catch (error) {
        // File doesn't exist = pristine chunk with no modifications
        console.log(`Chunk ${chunkId} has no saved data, creating empty state`);
        const emptyChunkData = { players: [], objectChanges: [], seed: terrainSeed };
        chunkCache.set(chunkId, emptyChunkData);
        return emptyChunkData;
    }
}

// Broadcast a message to all clients in a specific chunk
function broadcastToChunk(chunkId, message) {
    const recipients = [];
    clients.forEach((clientData, clientId) => {
        if (clientData && clientData.currentChunk === chunkId &&
            clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
            try {
                clientData.ws.send(JSON.stringify(message));
                recipients.push(clientId);
            } catch (err) {
                console.error(`Failed to send ${message.type} to ${clientId}:`, err);
            }
        }
    });
    console.log(`Broadcasted ${message.type} to chunk ${chunkId}. Recipients: ${recipients.join(',')}`);
}


// Get players in a 3x3 grid around a chunk
function getPlayersInProximity(chunkId) {
    const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);

    const players = [];

    // Check 3x3 grid (1-chunk radius)
    for (let x = chunkX - 1; x <= chunkX + 1; x++) {
    for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
        const targetChunkId = `chunk_${x},${z}`;
        const chunkData = loadChunk(targetChunkId); // Use loadChunk instead of chunkCache.get
        if (chunkData && chunkData.players) {
            chunkData.players.forEach(player => {
                players.push({ id: player.id, chunkId: targetChunkId });
            });
        }
    }
}
    return players;
}

// Process notification queue for rate limiting
function processNotificationQueue() {
    if (notificationQueue.length === 0) return;

    // Group events by affected chunk to avoid duplicate notifications
    const chunksToNotify = new Set(notificationQueue.map(event => event.chunkId));
    notificationQueue.length = 0; // Clear queue

    chunksToNotify.forEach(chunkId => {
        // Get players in the 3x3 grid around this chunk
        const proximatePlayers = getPlayersInProximity(chunkId);
        const affectedClients = new Set(proximatePlayers.map(p => p.id));

        // For each affected client, compute their own 3x3 grid player list
        affectedClients.forEach(clientId => {
            const clientData = clients.get(clientId);
            if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) return;

            const clientPlayers = getPlayersInProximity(clientData.currentChunk);
            try {
    clientData.ws.send(JSON.stringify({
        type: 'proximity_update',
        payload: { players: clientPlayers }
    }));
    console.log(`Sent proximity_update to ${clientId} with ${clientPlayers.length} players`);
} catch (err) {
    console.error(`Failed to send proximity_update to ${clientId}:`, err);
}

        });
    });
}

// Start notification queue processing
setInterval(processNotificationQueue, notificationInterval);

function broadcastTo3x3Grid(chunkId, message) {
    const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);
    const radius = 1;


    // build set of target chunk ids
    const targetChunks = new Set();
    for (let x = chunkX - radius; x <= chunkX + radius; x++) {
        for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
            targetChunks.add(`chunk_${x},${z}`);
        }
    }

    const recipients = [];
    clients.forEach((clientData, clientId) => {
        if (clientData && clientData.currentChunk && targetChunks.has(clientData.currentChunk) &&
            clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
            try {
                clientData.ws.send(JSON.stringify(message));
                recipients.push(clientId);
            } catch (err) {
                console.error(`Failed to send ${message.type} to ${clientId}:`, err);
            }
        }
    });

    console.log(`Broadcasted ${message.type} to 3x3 grid around chunk ${chunkId}. Recipients: ${recipients.join(',')}`);
}


// Handle new connections
wss.on('connection', ws => {
    console.log('A new client connected');

    // Send a welcome message
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!' }));

    ws.on('message', message => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error('Invalid message received:', error);
            return;
        }
        console.log('Received message:', parsedMessage);

        switch (parsedMessage.type) {
            case 'join_chunk':
                const chunkId = parsedMessage.payload.chunkId;
                const clientId = parsedMessage.payload.clientId; // Get clientId from message
                if (!clientId) {
                    console.error('No clientId provided in join_chunk');
                    ws.send(JSON.stringify({ type: 'error', message: 'No clientId provided' }));
                    return;
                }
                ws.clientId = clientId;
                clients.set(clientId, { ws, currentChunk: chunkId, lastChunk: null });

                let chunkData = loadChunk(chunkId);
                if (!chunkData) {
                    // Initialize chunk if it doesn't exist
                    chunkData = { players: [], objectChanges: [], seed: terrainSeed };
                    chunkCache.set(chunkId, chunkData);
                    saveChunk(chunkId);
                }

                const isPlayerInChunk = chunkData.players.some(p => p.id === clientId);
                if (!isPlayerInChunk) {
                    chunkData.players.push({ id: clientId });
                    console.log(`Client ${clientId} joined chunk: ${chunkId}`);
                    saveChunk(chunkId);
                }

                notificationQueue.push({ chunkId });
                // Send chunk_objects_state for 3x3 grid
const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);

const objectChanges = [];
for (let x = chunkX - 1; x <= chunkX + 1; x++) {
    for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
        const targetChunkId = `chunk_${x},${z}`;
        const targetChunkData = loadChunk(targetChunkId); // Use loadChunk instead of chunkCache.get
        if (targetChunkData && targetChunkData.objectChanges) {
            targetChunkData.objectChanges.forEach(change => {
                objectChanges.push({ ...change, chunkId: targetChunkId });
            });
        }
    }
}
                ws.send(JSON.stringify({
                    type: 'chunk_objects_state',
                    payload: { chunkId, objectChanges }
                }));
                console.log(`Sent chunk_objects_state for 3x3 grid around ${chunkId} to ${clientId}`);
                break;

            case 'chunk_update':
                const { clientId: updateClientId, newChunkId, lastChunkId } = parsedMessage.payload;
                const clientData = clients.get(updateClientId);
                if (!clientData) {
                    console.error(`Client ${updateClientId} not found for chunk_update`);
                    return;
                }

                // Update client data
                clientData.currentChunk = newChunkId;
                clientData.lastChunk = lastChunkId;

                // Update chunk data
                if (lastChunkId) {
                    const oldChunkData = chunkCache.get(lastChunkId);
                    if (oldChunkData) {
                        oldChunkData.players = oldChunkData.players.filter(p => p.id !== updateClientId);
                        saveChunk(lastChunkId);
                    }
                }

                let newChunkData = chunkCache.get(newChunkId);
                if (!newChunkData) {
                    newChunkData = { players: [], objectChanges: [], seed: terrainSeed };
                    chunkCache.set(newChunkId, newChunkData);
                }
                if (!newChunkData.players.some(p => p.id === updateClientId)) {
                    newChunkData.players.push({ id: updateClientId });
                    saveChunk(newChunkId);
                }

                // Send chunk_objects_state for 3x3 grid
                const [updateChunkX, updateChunkZ] = newChunkId.replace('chunk_', '').split(',').map(Number);

                const updateObjectChanges = [];
for (let x = updateChunkX - 1; x <= updateChunkX + 1; x++) {
    for (let z = updateChunkZ - 1; z <= updateChunkZ + 1; z++) {
        const targetChunkId = `chunk_${x},${z}`;
        const targetChunkData = loadChunk(targetChunkId); // Use loadChunk instead of chunkCache.get
        if (targetChunkData && targetChunkData.objectChanges) {
            targetChunkData.objectChanges.forEach(change => {
                updateObjectChanges.push({ ...change, chunkId: targetChunkId });
            });
        }
    }
}
                clientData.ws.send(JSON.stringify({
                    type: 'chunk_objects_state',
                    payload: { chunkId: newChunkId, objectChanges: updateObjectChanges }
                }));
                console.log(`Sent chunk_objects_state for 3x3 grid around ${newChunkId} to ${updateClientId}`);

                // Queue notifications for both chunks
                notificationQueue.push({ chunkId: newChunkId });
                if (lastChunkId) {
                    notificationQueue.push({ chunkId: lastChunkId });
                }
                console.log(`Processed chunk_update for ${updateClientId}: ${lastChunkId || 'none'} -> ${newChunkId}`);
                break;

            case 'add_box_request':
                const addChunkId = parsedMessage.payload.chunkId;
                const addChunkData = chunkCache.get(addChunkId);
                if (addChunkData) {
                    addChunkData.boxPresent = true;
                    saveChunk(addChunkId);
                    broadcastToChunk(addChunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: addChunkId, state: addChunkData }
                    });
                }
                break;

            case 'remove_box_request':
                const removeChunkId = parsedMessage.payload.chunkId;
                const removeChunkData = chunkCache.get(removeChunkId);
                if (removeChunkData) {
                    removeChunkData.boxPresent = false;
                    saveChunk(removeChunkId);
                    broadcastToChunk(removeChunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: removeChunkId, state: removeChunkData }
                    });
                }
                break;

            case 'add_object_request':
                try {
                    const { chunkId: addObjChunkId, objectType, objectPosition, objectQuality, objectScale, objectId: addObjectId, totalResources, remainingResources } = parsedMessage.payload;

                    let addObjChunkData = loadChunk(addObjChunkId);

                    const addChange = {
                        action: 'add',
                        id: addObjectId,
                        name: objectType,
                        position: objectPosition,
                        quality: objectQuality,
                        scale: objectScale,
                        chunkId: addObjChunkId,
                        totalResources: totalResources || null,
                        remainingResources: remainingResources || null,
                        harvestedBy: null,
                        harvestStartTime: null
                    };
                    addObjChunkData.objectChanges.push(addChange);

                    saveChunk(addObjChunkId);

                    broadcastTo3x3Grid(addObjChunkId, {
                        type: 'object_added',
                        payload: {
                            chunkId: addObjChunkId,
                            objectId: addObjectId,
                            objectType,
                            position: objectPosition,
                            quality: objectQuality,
                            scale: objectScale,
                            totalResources,
                            remainingResources
                        }
                    });

                    console.log(`Processed add_object_request for ${objectType} (quality: ${objectQuality}, resources: ${remainingResources}/${totalResources}) in chunk ${addObjChunkId}`);
                } catch (error) {
                    console.error('ERROR in add_object_request:', error);
                }
                break;

            case 'place_construction_site':
                try {
                    const { position, rotation, scale, targetStructure, finalFoundationY, finalCrateY, foundationId } = parsedMessage.payload;

                    // Calculate chunk from position
                    const chunkX = Math.floor(position[0] / 16);
                    const chunkZ = Math.floor(position[2] / 16);
                    const constructionChunkId = `chunk_${chunkX},${chunkZ}`;

                    // Generate unique ID for construction site
                    const constructionId = `construction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    let constructionChunkData = loadChunk(constructionChunkId);

                    // ADDING NEW STRUCTURES - STEP 5: MATERIAL REQUIREMENTS
                    // Define what materials are needed to build your structure.
                    // Format: { 'material_id': quantity }
                    // Material IDs must match inventory item IDs.
                    // Add your structure type here with its required materials.
                    let requiredMaterials;
                    if (targetStructure === 'crate') {
                        requiredMaterials = { 'oakplank': 1 };  // Crates require oak planks
                    } else if (targetStructure === 'outpost') {
                        requiredMaterials = { 'oakplank': 1 };  // Outpost requires just 1 oak plank
                    } else if (targetStructure === 'tent') {
                        requiredMaterials = { 'oakplank': 1 };  // Tent requires just 1 oak plank
                    } else {
                        requiredMaterials = { 'chiseledlimestone': 1 };  // Foundations require chiseled limestone
                        // Add more structure types here:
                        // } else if (targetStructure === 'mystructure') {
                        //     requiredMaterials = { 'material1': 2, 'material2': 1 };
                    }

                    const constructionChange = {
                        action: 'add',
                        id: constructionId,
                        name: 'construction',
                        position: position,
                        quality: null,
                        scale: scale,
                        chunkId: constructionChunkId,
                        totalResources: null,
                        remainingResources: null,
                        harvestedBy: null,
                        harvestStartTime: null,
                        isConstructionSite: true,
                        targetStructure: targetStructure,
                        rotation: rotation,
                        requiredMaterials: requiredMaterials,
                        materials: {},
                        finalFoundationY: finalFoundationY,  // Store preview Y for final foundation
                        finalCrateY: finalCrateY,  // Store Y for crate
                        foundationId: foundationId  // Link to foundation (for crates)
                    };
                    constructionChunkData.objectChanges.push(constructionChange);

                    saveChunk(constructionChunkId);

                    broadcastTo3x3Grid(constructionChunkId, {
                        type: 'object_added',
                        payload: {
                            chunkId: constructionChunkId,
                            objectId: constructionId,
                            objectType: 'construction',
                            position: position,
                            quality: null,
                            scale: scale,
                            rotation: rotation,
                            totalResources: null,
                            remainingResources: null,
                            isConstructionSite: true,
                            targetStructure: targetStructure,
                            requiredMaterials: requiredMaterials,
                            materials: {},
                            finalFoundationY: finalFoundationY,
                            finalCrateY: finalCrateY,
                            foundationId: foundationId
                        }
                    });

                    console.log(`Processed place_construction_site in chunk ${constructionChunkId} at position [${position}], target: ${targetStructure}`);
                } catch (error) {
                    console.error('ERROR in place_construction_site:', error);
                }
                break;

            case 'build_construction':
                try {
                    const { constructionId, chunkKey } = parsedMessage.payload;

                    // Add "chunk_" prefix to match file naming convention
                    const fullChunkId = `chunk_${chunkKey}`;
                    let buildChunkData = loadChunk(fullChunkId);

                    // Find the construction site in objects or objectChanges
                    let constructionSite = null;

                    // Check in existing objects (if array exists)
                    if (Array.isArray(buildChunkData.objects)) {
                        for (const obj of buildChunkData.objects) {
                            if (obj.id === constructionId && obj.isConstructionSite) {
                                constructionSite = obj;
                                break;
                            }
                        }
                    }

                    // Check in objectChanges if not found
                    if (!constructionSite && Array.isArray(buildChunkData.objectChanges)) {
                        for (const change of buildChunkData.objectChanges) {
                            if (change.action === 'add' && change.id === constructionId && change.isConstructionSite) {
                                constructionSite = change;
                                break;
                            }
                        }
                    }

                    if (!constructionSite) {
                        console.error(`Construction site ${constructionId} not found in chunk ${chunkKey}`);
                        break;
                    }

                    // Get construction site data
                    const csPosition = constructionSite.position;
                    const csRotation = constructionSite.rotation;
                    const csTargetStructure = constructionSite.targetStructure;
                    const csFinalFoundationY = constructionSite.finalFoundationY;
                    const csFinalCrateY = constructionSite.finalCrateY;
                    const csFoundationId = constructionSite.foundationId;  // For crates

                    // Calculate average quality from materials (default to 50 if no materials)
                    const materials = constructionSite.materials || {};
                    let totalQuality = 0;
                    let materialCount = 0;

                    for (const [materialType, quantity] of Object.entries(materials)) {
                        // For now, assume quality of 50 for materials (could be enhanced later)
                        totalQuality += 50 * quantity;
                        materialCount += quantity;
                    }

                    const structureQuality = materialCount > 0 ? Math.round(totalQuality / materialCount) : 50;

                    // Remove construction site
                    const removeChange = {
                        action: 'remove',
                        id: constructionId,
                        chunkId: fullChunkId
                    };
                    buildChunkData.objectChanges.push(removeChange);

                    // Generate ID for structure
                    const structureId = `${csTargetStructure}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    // Determine final Y position based on structure type
                    let finalY;
                    if (csTargetStructure === 'crate') {
                        finalY = csFinalCrateY;
                    } else {
                        finalY = csFinalFoundationY;
                    }

                    // Add structure at the appropriate Y position
                    const structurePosition = [csPosition[0], finalY, csPosition[2]];

                    // Determine scale based on structure type
                    let structureScale = 0.5;  // Default for foundations and crates
                    if (csTargetStructure === 'outpost') {
                        structureScale = 0.03;
                    } else if (csTargetStructure === 'tent') {
                        structureScale = 0.5;
                    }

                    const structureChange = {
                        action: 'add',
                        id: structureId,
                        name: csTargetStructure,
                        position: structurePosition,
                        quality: structureQuality,
                        scale: structureScale,
                        chunkId: fullChunkId,
                        totalResources: null,
                        remainingResources: null,
                        harvestedBy: null,
                        harvestStartTime: null,
                        rotation: csRotation
                    };

                    // For crates, store reference to foundation for cascade deletion
                    if (csTargetStructure === 'crate' && csFoundationId) {
                        structureChange.foundationId = csFoundationId;
                    }

                    buildChunkData.objectChanges.push(structureChange);

                    saveChunk(fullChunkId);

                    // Broadcast removal of construction site
                    broadcastTo3x3Grid(fullChunkId, {
                        type: 'object_removed',
                        payload: {
                            chunkId: fullChunkId,
                            objectId: constructionId
                        }
                    });

                    // Broadcast addition of structure (foundation or crate)
                    broadcastTo3x3Grid(fullChunkId, {
                        type: 'object_added',
                        payload: {
                            chunkId: fullChunkId,
                            objectId: structureId,
                            objectType: csTargetStructure,
                            position: structurePosition,
                            quality: structureQuality,
                            scale: structureScale,
                            rotation: csRotation,
                            totalResources: null,
                            remainingResources: null
                        }
                    });

                    console.log(`Processed build_construction: removed ${constructionId}, added ${structureId} (${csTargetStructure}) in chunk ${fullChunkId}`);
                } catch (error) {
                    console.error('ERROR in build_construction:', error);
                }
                break;

            case 'get_crate_inventory':
                try {
                    const { crateId, chunkId: crateChunkId } = parsedMessage.payload;
                    const crateChunkData = loadChunk(crateChunkId);

                    // Find the crate in the chunk
                    const crateChange = crateChunkData.objectChanges.find(c => c.id === crateId && c.action === 'add');

                    let crateInventory = { items: [] };
                    if (crateChange && crateChange.inventory) {
                        crateInventory = crateChange.inventory;
                    }

                    // Send inventory back to client
                    ws.send(JSON.stringify({
                        type: 'crate_inventory_response',
                        payload: {
                            crateId: crateId,
                            inventory: crateInventory
                        }
                    }));

                    console.log(`Sent crate inventory for ${crateId}: ${crateInventory.items.length} items`);
                } catch (error) {
                    console.error('ERROR in get_crate_inventory:', error);
                }
                break;

            case 'save_crate_inventory':
                try {
                    const { crateId, chunkId: saveChunkId, inventory } = parsedMessage.payload;
                    const saveChunkData = loadChunk(saveChunkId);

                    // Find the crate in the chunk
                    const crateIndex = saveChunkData.objectChanges.findIndex(c => c.id === crateId && c.action === 'add');

                    if (crateIndex !== -1) {
                        // Update crate inventory
                        saveChunkData.objectChanges[crateIndex].inventory = inventory;
                        saveChunk(saveChunkId);

                        console.log(`Saved crate inventory for ${crateId}: ${inventory.items.length} items`);

                        // Broadcast inventory update to all clients
                        broadcastToChunk(saveChunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: crateId,
                                inventory: inventory
                            }
                        });
                    } else {
                        console.error(`Crate ${crateId} not found in chunk ${saveChunkId}`);
                    }
                } catch (error) {
                    console.error('ERROR in save_crate_inventory:', error);
                }
                break;

            case 'remove_object_request':
                const { chunkId: removeObjChunkId, objectId, name, position, quality, scale } = parsedMessage.payload;
                // loadChunk now always returns valid data, never null
let removeObjChunkData = loadChunk(removeObjChunkId);
                const change = { action: 'remove', id: objectId, name, position, quality, scale, chunkId: removeObjChunkId };
                const existingIndex = removeObjChunkData.objectChanges.findIndex(c => c.id === objectId);
                if (existingIndex !== -1) {
                    removeObjChunkData.objectChanges[existingIndex] = change;
                } else {
                    removeObjChunkData.objectChanges.push(change);
                }
                saveChunk(removeObjChunkId);
                broadcastTo3x3Grid(removeObjChunkId, {
                    type: 'object_removed',
                    payload: { chunkId: removeObjChunkId, objectId, name, position, quality, scale }
                });
                console.log(`Processed remove_object_request for ${objectId} (quality: ${quality}, scale: ${scale}) in chunk ${removeObjChunkId}`);

                // ADDING NEW STRUCTURES - STEP 6: CASCADE DELETION (OPTIONAL)
                // If your structure depends on another (like crate on foundation),
                // add cascade deletion logic here to remove dependent structures
                // when the base structure is removed.
                // Check foundationId field to identify dependencies.
                if (name === 'foundation' || name === 'foundationcorner' || name === 'foundationroundcorner') {
                    console.log(`Foundation ${objectId} removed, checking for crates and construction sites to cascade delete`);

                    // Search through all loaded chunks for structures linked to this foundation
                    const cratesToRemove = [];
                    const constructionSitesToRemove = [];

                    // Get all chunk files to search
                    const chunkFiles = fs.readdirSync('./public').filter(f => f.startsWith('chunk_') && f.endsWith('.JSON'));

                    for (const chunkFile of chunkFiles) {
                        const searchChunkId = chunkFile.replace('.JSON', ''); // Keep "chunk_" prefix
                        const searchChunkData = loadChunk(searchChunkId);

                        // Find crates and construction sites in this chunk that reference the removed foundation
                        for (const change of searchChunkData.objectChanges) {
                            if (change.action === 'add') {
                                // Debug: log all items with foundationId
                                if (change.foundationId) {
                                    console.log(`  Found object with foundationId: ${change.name} (id: ${change.id}, foundationId: ${change.foundationId})`);
                                }
                                // Check for crates linked to this foundation
                                if (change.name === 'crate' && change.foundationId === objectId) {
                                    console.log(`  -> Found crate to cascade delete: ${change.id}`);
                                    cratesToRemove.push({
                                        chunkId: searchChunkId,
                                        crateId: change.id,
                                        crateName: change.name,
                                        cratePosition: change.position,
                                        crateQuality: change.quality,
                                        crateScale: change.scale
                                    });
                                }
                                // Check for construction sites targeting crates on this foundation
                                else if (change.name === 'construction' && change.foundationId === objectId) {
                                    console.log(`  -> Found construction site to cascade delete: ${change.id}`);
                                    constructionSitesToRemove.push({
                                        chunkId: searchChunkId,
                                        siteId: change.id,
                                        siteName: change.name,
                                        sitePosition: change.position,
                                        siteQuality: change.quality,
                                        siteScale: change.scale
                                    });
                                }
                            }
                        }
                    }

                    // Remove all found crates
                    for (const crateInfo of cratesToRemove) {
                        let crateChunkData = loadChunk(crateInfo.chunkId);
                        const crateChange = {
                            action: 'remove',
                            id: crateInfo.crateId,
                            name: crateInfo.crateName,
                            position: crateInfo.cratePosition,
                            quality: crateInfo.crateQuality,
                            scale: crateInfo.crateScale,
                            chunkId: crateInfo.chunkId
                        };

                        const crateExistingIndex = crateChunkData.objectChanges.findIndex(c => c.id === crateInfo.crateId);
                        if (crateExistingIndex !== -1) {
                            crateChunkData.objectChanges[crateExistingIndex] = crateChange;
                        } else {
                            crateChunkData.objectChanges.push(crateChange);
                        }

                        saveChunk(crateInfo.chunkId);
                        broadcastTo3x3Grid(crateInfo.chunkId, {
                            type: 'object_removed',
                            payload: {
                                chunkId: crateInfo.chunkId,
                                objectId: crateInfo.crateId,
                                name: crateInfo.crateName,
                                position: crateInfo.cratePosition,
                                quality: crateInfo.crateQuality,
                                scale: crateInfo.crateScale
                            }
                        });

                        console.log(`Cascade deleted crate ${crateInfo.crateId} from chunk ${crateInfo.chunkId}`);
                    }

                    // Remove all found construction sites
                    for (const siteInfo of constructionSitesToRemove) {
                        let siteChunkData = loadChunk(siteInfo.chunkId);
                        const siteChange = {
                            action: 'remove',
                            id: siteInfo.siteId,
                            name: siteInfo.siteName,
                            position: siteInfo.sitePosition,
                            quality: siteInfo.siteQuality,
                            scale: siteInfo.siteScale,
                            chunkId: siteInfo.chunkId
                        };

                        const siteExistingIndex = siteChunkData.objectChanges.findIndex(c => c.id === siteInfo.siteId);
                        if (siteExistingIndex !== -1) {
                            siteChunkData.objectChanges[siteExistingIndex] = siteChange;
                        } else {
                            siteChunkData.objectChanges.push(siteChange);
                        }

                        saveChunk(siteInfo.chunkId);
                        broadcastTo3x3Grid(siteInfo.chunkId, {
                            type: 'object_removed',
                            payload: {
                                chunkId: siteInfo.chunkId,
                                objectId: siteInfo.siteId,
                                name: siteInfo.siteName,
                                position: siteInfo.sitePosition,
                                quality: siteInfo.siteQuality,
                                scale: siteInfo.siteScale
                            }
                        });

                        console.log(`Cascade deleted construction site ${siteInfo.siteId} from chunk ${siteInfo.chunkId}`);
                    }

                    if (cratesToRemove.length > 0 || constructionSitesToRemove.length > 0) {
                        console.log(`Cascade deletion complete: removed ${cratesToRemove.length} crate(s) and ${constructionSitesToRemove.length} construction site(s)`);
                    }
                }
                break;

            case 'harvest_resource_request':
                try {
                    const { chunkId: harvestChunkId, objectId: harvestObjectId, harvestType, clientId, objectData } = parsedMessage.payload;
                    let harvestChunkData = loadChunk(harvestChunkId);

                    // Find the resource in objectChanges
                    let resourceIndex = harvestChunkData.objectChanges.findIndex(c => c.id === harvestObjectId && c.action === 'add');

                    // If not found, this is a natural resource being interacted with for the first time
                    if (resourceIndex === -1) {
                        console.log(`Natural resource ${harvestObjectId} first interaction - creating change entry`);

                        // Create change entry using client-provided data
                        const changeEntry = {
                            action: 'add',
                            id: harvestObjectId,
                            name: objectData.name,
                            position: objectData.position,
                            quality: objectData.quality,
                            scale: objectData.scale,
                            totalResources: objectData.totalResources,
                            remainingResources: objectData.remainingResources,
                            chunkId: harvestChunkId,
                            harvestedBy: null,
                            harvestStartTime: null
                        };

                        harvestChunkData.objectChanges.push(changeEntry);
                        resourceIndex = harvestChunkData.objectChanges.length - 1;
                    }

                    const resource = harvestChunkData.objectChanges[resourceIndex];
                    const now = Date.now();

                    // Check if resource is locked by another player
                    if (resource.harvestedBy && resource.harvestedBy !== clientId) {
                        // Check if lock has timed out (15 seconds)
                        const lockAge = now - (resource.harvestStartTime || 0);
                        if (lockAge < 15000) {
                            // Still locked by another player
                            const clientData = clients.get(clientId);
                            if (clientData && clientData.ws) {
                                clientData.ws.send(JSON.stringify({
                                    type: 'harvest_lock_failed',
                                    payload: {
                                        objectId: harvestObjectId,
                                        reason: 'Another player is harvesting this resource'
                                    }
                                }));
                            }
                            console.log(`Harvest lock failed for ${harvestObjectId}: locked by ${resource.harvestedBy}`);
                            break;
                        } else {
                            // Lock timed out, clear it
                            console.log(`Lock timeout for ${harvestObjectId}, clearing stale lock`);
                            resource.harvestedBy = null;
                            resource.harvestStartTime = null;
                        }
                    }

                    // Acquire lock for this harvest
                    resource.harvestedBy = clientId;
                    resource.harvestStartTime = now;

                    // Decrement resources
                    if (resource.remainingResources > 0) {
                        resource.remainingResources -= 1;

                        // If depleted, mark for removal and clear lock
                        if (resource.remainingResources <= 0) {
                            resource.action = 'remove';
                            resource.harvestedBy = null;
                            resource.harvestStartTime = null;
                        } else {
                            // Clear lock after successful harvest
                            resource.harvestedBy = null;
                            resource.harvestStartTime = null;
                        }

                        saveChunk(harvestChunkId);

                        // Broadcast update to all clients in 3x3 grid
                        broadcastTo3x3Grid(harvestChunkId, {
                            type: 'resource_harvested',
                            payload: {
                                chunkId: harvestChunkId,
                                objectId: harvestObjectId,
                                harvestType: harvestType,
                                remainingResources: resource.remainingResources,
                                depleted: resource.remainingResources <= 0,
                                harvestedBy: clientId
                            }
                        });

                        console.log(`Processed harvest_resource_request: ${harvestObjectId} (${harvestType}), remaining: ${resource.remainingResources}`);
                    } else {
                        console.warn(`Resource ${harvestObjectId} already depleted`);
                    }
                } catch (error) {
                    console.error('ERROR in harvest_resource_request:', error);
                }
                break;

            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice_candidate':
                const recipientId = parsedMessage.payload.recipientId;
                const recipientData = clients.get(recipientId);
                if (recipientData && recipientData.ws) {
                    recipientData.ws.send(message);
                    console.log(`Forwarded ${parsedMessage.type} from ${ws.clientId} to ${recipientId}`);
                } else {
                    console.error(`Recipient ${recipientId} not found`);
                }
                break;

            default:
                console.error('Unknown message type:', parsedMessage.type);
        }
    });

    ws.on('close', () => {
        if (ws.clientId) {
            console.log(`Client ${ws.clientId} disconnected`);
            const clientData = clients.get(ws.clientId);
            if (clientData && clientData.currentChunk) {
                const chunkData = chunkCache.get(clientData.currentChunk);
                if (chunkData) {
                    chunkData.players = chunkData.players.filter(p => p.id !== ws.clientId);
                    console.log(`Client ${ws.clientId} left chunk: ${clientData.currentChunk}`);
                    saveChunk(clientData.currentChunk);
                    notificationQueue.push({ chunkId: clientData.currentChunk });
                    console.log(`Queued proximity_update for chunk ${clientData.currentChunk} due to disconnection`);
                }
            }
            clients.delete(ws.clientId);
        }
    });
});

// A periodic check to verify players from the file are still connected
const interval = setInterval(() => {
    console.log('Starting periodic player check...');
    chunkCache.forEach((chunkData, chunkId) => {
        const playersToRemove = [];
        chunkData.players.forEach(player => {
            const clientData = clients.get(player.id);
            if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) {
                console.log(`Removing disconnected player ${player.id} from chunk ${chunkId}`);
                playersToRemove.push(player.id);
            }
        });

        if (playersToRemove.length > 0) {
            chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
            saveChunk(chunkId);
            notificationQueue.push({ chunkId });
            console.log(`Queued proximity_update for chunk ${chunkId} due to cleanup`);
        }
    });
    console.log('Periodic player check finished');
}, 60000);

// Clean up the interval when the server closes
wss.on('close', () => {
    clearInterval(interval);
});
const WebSocket = require('ws');
const fs = require('fs');

// Create a new WebSocket server on port 8080
const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

// Constants for terrain editing
const TERRAIN_EDIT_INTENSITY = 0.75; //intensity
const TERRAIN_EDIT_RADIUS = 2.0;
const MAX_SLOPE_THRESHOLD = 1.0; // tan(30 degrees)
const EDIT_COOLDOWN_MS = 1000;
const terrainSeed = 12345; // Existing global seed

// Mulberry32 RNG
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Optimized Perlin noise class (copied/adapted from terrain.js worker)
class OptimizedPerlin {
    constructor(seed = 12345) {
        this.p = new Array(512);
        const perm = [];
        const rng = mulberry32(seed);
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        for (let i = 0; i < 256; i++) this.p[i] = this.p[i + 256] = perm[i];
    }
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    noise(x, y, z) {
        let X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        let u = this.fade(x), v = this.fade(y), w = this.fade(z);
        let A = this.p[X] + Y, AA = this.p[A] + Z, AB = this.p[A + 1] + Z;
        let B = this.p[X + 1] + Y, BA = this.p[B] + Z, BB = this.p[B + 1] + Z;
        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)),
                this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))
            ),
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))
            )
        );
    }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Calculate base procedural height (adapted from worker)
function calculateBaseHeight(x, z) {
    const perlin = new OptimizedPerlin(terrainSeed);
    let base = 0, amp = 1, freq = 0.02;
    for (let o = 0; o < 3; o++) { base += perlin.noise(x * freq, z * freq, 10 + o * 7) * amp; amp *= 0.5; freq *= 2; }
    let maskRaw = perlin.noise(x * 0.006, z * 0.006, 400);
    let mask = Math.pow((maskRaw + 1) * 0.5, 3);
    let mountain = 0; amp = 1; freq = 0.04;
    for (let o = 0; o < 4; o++) { mountain += Math.abs(perlin.noise(x * freq, z * freq, 500 + o * 11)) * amp; amp *= 0.5; freq *= 2; }
    mountain *= 40 * mask;
    const elevNorm = clamp((base + mountain + 2) / 25, 0, 1);
    let jagged = perlin.noise(x * 0.8, z * 0.8, 900) * 1.2 * elevNorm + perlin.noise(x * 1.6, z * 1.6, 901) * 0.6 * elevNorm;
    return base + mountain + jagged;
}

// Get delta from a modification at a point (Gaussian falloff)
function getDelta(mod, px, pz) {
    const distSq = (px - mod.x) ** 2 + (pz - mod.z) ** 2;
    const dist = Math.sqrt(distSq);
    if (dist > mod.radius) return 0;
    const falloff = Math.exp(-distSq / (2 * mod.radius ** 2));
    return mod.heightDelta * falloff;
}

// Get chunk ID for a world point
function getChunkForPoint(x, z) {
    const chunkSize = 50;
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    return `chunk_${cx}_${cz}`;
}

// Get all chunk IDs affected by an edit (bounding box approximation)
function getAffectedChunks(x, z, radius) {
    const chunkSize = 50;
    const minX = Math.floor((x - radius) / chunkSize);
    const maxX = Math.floor((x + radius) / chunkSize);
    const minZ = Math.floor((z - radius) / chunkSize);
    const maxZ = Math.floor((z + radius) / chunkSize);
    const chunks = [];
    for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
            chunks.push(`chunk_${cx}_${cz}`);
        }
    }
    return chunks;
}

// Validate if proposed mod would exceed slope threshold
function isSlopeValid(proposedMod) {
    const affected = getAffectedChunks(proposedMod.x, proposedMod.z, proposedMod.radius);
    const chunkDatas = {};
    affected.forEach(id => {
        const data = loadChunk(id);
        chunkDatas[id] = data ? data : { players: [], boxPresent: false, seed: terrainSeed, terrainModifications: [] };
    });

    // Center height with proposed
    const centerChunkId = getChunkForPoint(proposedMod.x, proposedMod.z);
    let centerH = calculateBaseHeight(proposedMod.x, proposedMod.z);
    chunkDatas[centerChunkId].terrainModifications.forEach(mod => {
        centerH += getDelta(mod, proposedMod.x, proposedMod.z);
    });
    centerH += getDelta(proposedMod, proposedMod.x, proposedMod.z);

    // Check 8 sample points at radius
    const samples = 8;
    const angleStep = 2 * Math.PI / samples;
    for (let i = 0; i < samples; i++) {
        const angle = i * angleStep;
        const sx = proposedMod.x + TERRAIN_EDIT_RADIUS * Math.cos(angle);
        const sz = proposedMod.z + TERRAIN_EDIT_RADIUS * Math.sin(angle);
        const dist = Math.sqrt((sx - proposedMod.x) ** 2 + (sz - proposedMod.z) ** 2);

        const sampleChunkId = getChunkForPoint(sx, sz);
        let sampleH = calculateBaseHeight(sx, sz);
        chunkDatas[sampleChunkId].terrainModifications.forEach(mod => {
            sampleH += getDelta(mod, sx, sz);
        });
        if (dist <= proposedMod.radius) {
            sampleH += getDelta(proposedMod, sx, sz);
        }

        const horizDist = Math.max(dist, 0.01); // Prevent division by zero
const vertDiff = Math.abs(centerH - sampleH);
const slope = vertDiff / horizDist;
if (slope > MAX_SLOPE_THRESHOLD) {
    return false;
}
    }
    return true;
}

// A simple in-memory cache to hold our chunk data
const chunkCache = new Map();
// A map to store client data with WebSocket, currentChunk, lastChunk, and lastEditTime
const clients = new Map();

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

function loadChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        return chunkCache.get(chunkId);
    }
    
    const filePath = `./public/${chunkId}.JSON`;
    
    try {
        const fileData = fs.readFileSync(filePath, 'utf8');
        const chunkData = JSON.parse(fileData);
        if (!chunkData.terrainModifications) {
            chunkData.terrainModifications = [];
        }
        chunkCache.set(chunkId, chunkData);
        console.log(`Loaded chunk: ${chunkId}`);
        return chunkData;
    } catch (error) {
        // Instead of logging error, create and return default chunk
        console.log(`Creating new chunk: ${chunkId}`);
        const chunkData = { 
            players: [], 
            boxPresent: false, 
            seed: terrainSeed, 
            terrainModifications: [] 
        };
        chunkCache.set(chunkId, chunkData);
        saveChunk(chunkId);
        return chunkData;
    }
}

// Broadcast a message to all clients in a specific chunk
function broadcastToChunk(chunkId, message) {
    wss.clients.forEach(client => {
        if (client.currentChunk === chunkId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
    console.log(`Broadcasted ${message.type} to chunk ${chunkId}`);
}

// Get players in a 3x3 grid around a chunk
function getPlayersInProximity(chunkId) {
    const parts = chunkId.split('_');
    const chunkX = parseInt(parts[1]);
    const chunkZ = parseInt(parts[2]);
    const players = [];

    // Check 3x3 grid (1-chunk radius)
    for (let x = chunkX - 1; x <= chunkX + 1; x++) {
        for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
            const targetChunkId = `chunk_${x}_${z}`;
            const chunkData = chunkCache.get(targetChunkId);
            if (chunkData) {
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
            clientData.ws.send(JSON.stringify({
                type: 'proximity_update',
                payload: { players: clientPlayers }
            }));
            console.log(`Sent proximity_update to ${clientId} with ${clientPlayers.length} players`);
        });
    });
}

// Start notification queue processing
setInterval(processNotificationQueue, notificationInterval);

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
                clients.set(clientId, { ws, currentChunk: chunkId, lastChunk: null, lastEditTime: 0 });

                let chunkData = loadChunk(chunkId);
                if (!chunkData) {
                    // Initialize chunk if it doesn't exist
chunkData = { players: [], boxPresent: false, seed: terrainSeed, heightOverrides: {} };
                    chunkCache.set(chunkId, chunkData);
                    saveChunk(chunkId);
                }

                const isPlayerInChunk = chunkData.players.some(p => p.id === clientId);
                if (!isPlayerInChunk) {
                    chunkData.players.push({ id: clientId });
                    console.log(`Client ${clientId} joined chunk: ${chunkId}`);
                    saveChunk(chunkId);
                }

                // Send chunk state to the joining client
                ws.send(JSON.stringify({
                    type: 'chunk_state_change',
                    payload: { chunkId, state: chunkData }
                }));

                notificationQueue.push({ chunkId });

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
                clientData.ws.currentChunk = newChunkId; // Update for compatibility

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
                    newChunkData = { players: [], boxPresent: false, seed: terrainSeed, terrainModifications: [] };
                    chunkCache.set(newChunkId, newChunkData);
                }
                if (!newChunkData.players.some(p => p.id === updateClientId)) {
                    newChunkData.players.push({ id: updateClientId });
                    saveChunk(newChunkId);
                }

                // Send new chunk state to the client
                clientData.ws.send(JSON.stringify({
                    type: 'chunk_state_change',
                    payload: { chunkId: newChunkId, state: newChunkData }
                }));

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

            case 'terrain_edit_request':
                const { editType, x, z, chunkId: requestChunkId, clientId: editClientId } = parsedMessage.payload;
                const editClientData = clients.get(editClientId);
                if (!editClientData) {
                    console.error(`Client ${editClientId} not found for terrain_edit_request`);
                    return;
                }
                if (requestChunkId !== editClientData.currentChunk) {
                    ws.send(JSON.stringify({
                        type: 'terrain_edit_response',
                        payload: { success: false, error: 'Edit must be in your current chunk' }
                    }));
                    return;
                }
                if (Date.now() - editClientData.lastEditTime < EDIT_COOLDOWN_MS) {
                    ws.send(JSON.stringify({
                        type: 'terrain_edit_response',
                        payload: { success: false, error: 'Edit cooldown active' }
                    }));
                    return;
                }

                const heightDelta = (editType === 'raise' ? TERRAIN_EDIT_INTENSITY : -TERRAIN_EDIT_INTENSITY);
                const proposedMod = { x, z, heightDelta, timestamp: Date.now(), playerId: editClientId, radius: TERRAIN_EDIT_RADIUS };

                    let slopeValid = true;
try {
    slopeValid = isSlopeValid(proposedMod);
} catch (error) {
    console.error(`Slope validation failed for edit at (${x}, ${z}):`, error.message);
    slopeValid = false;
}

if (!slopeValid) {
                    ws.send(JSON.stringify({
                        type: 'terrain_edit_response',
                        payload: { success: false, error: 'Edit would create slope steeper than 30 degrees' }
                    }));
                    return;
                }

                // Valid: Update lastEditTime
                editClientData.lastEditTime = Date.now();

                // REPLACE with this new height-based system:
const affectedChunkIds = getAffectedChunks(x, z, TERRAIN_EDIT_RADIUS);
affectedChunkIds.forEach(affectedId => {
    let affectedData = loadChunk(affectedId);
    if (!affectedData) {
        affectedData = { players: [], boxPresent: false, seed: terrainSeed, heightOverrides: {} };
        chunkCache.set(affectedId, affectedData);
    }
    
    // Ensure heightOverrides exists for backward compatibility
    if (!affectedData.heightOverrides) {
        affectedData.heightOverrides = {};
    }
    
    // Calculate affected grid points within radius (1.0 unit precision)
    const minGridX = Math.floor(x - TERRAIN_EDIT_RADIUS);
    const maxGridX = Math.ceil(x + TERRAIN_EDIT_RADIUS);
    const minGridZ = Math.floor(z - TERRAIN_EDIT_RADIUS);
    const maxGridZ = Math.ceil(z + TERRAIN_EDIT_RADIUS);
    
    for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ++) {
            const dist = Math.sqrt((gridX - x) ** 2 + (gridZ - z) ** 2);
            if (dist <= TERRAIN_EDIT_RADIUS) {
                // Calculate falloff and new absolute height
                const falloff = Math.exp(-(dist ** 2) / (2 * TERRAIN_EDIT_RADIUS ** 2));
                const baseHeight = calculateBaseHeight(gridX, gridZ);
                const currentHeight = affectedData.heightOverrides[`${gridX},${gridZ}`] || baseHeight;
                const newHeight = currentHeight + (heightDelta * falloff);
                
                affectedData.heightOverrides[`${gridX},${gridZ}`] = newHeight;
            }
        }
    }
    
    saveChunk(affectedId);
    notificationQueue.push({ chunkId: affectedId });
});

                // Broadcast to affected proximities
                const affectedPlayers = new Set();
                affectedChunkIds.forEach(affectedId => {
                    getPlayersInProximity(affectedId).forEach(p => affectedPlayers.add(p.id));
                });
                affectedPlayers.forEach(playerId => {
    const playerData = clients.get(playerId);
    if (playerData && playerData.ws.readyState === WebSocket.OPEN) {
        // Send the affected chunks with their height overrides
        const chunkUpdates = {};
        affectedChunkIds.forEach(chunkId => {
            const chunkData = chunkCache.get(chunkId);
            if (chunkData && chunkData.heightOverrides) {
                chunkUpdates[chunkId] = chunkData.heightOverrides;
            }
        });
        
        playerData.ws.send(JSON.stringify({
            type: 'terrain_edit_response',
            payload: {
                success: true,
                chunkHeightUpdates: chunkUpdates,
                affectedChunkIds
            }
        }));
    }
});




                console.log(`Processed terrain_edit_request for ${editClientId} in ${requestChunkId}`);

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
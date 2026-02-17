/**
 * AdminFactionChange.js
 * One-off script to change a player's faction and update all their structures
 *
 * Usage: node server/AdminFactionChange.js
 */

const WebSocket = require('ws');
require('dotenv').config();

const PLAYER_ID = 'fa48717a-f00d-46e4-9fa5-b025177d7a14'; // mag5
const NEW_FACTION = 1; // Southguard
const CHUNK_ID = 'chunk_-24,4';

const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
    console.error('Error: ADMIN_SECRET not found in .env file');
    process.exit(1);
}

const SERVER_URL = 'wss://multiplayer-game-dcwy.onrender.com';

function sendQuery(ws, sql) {
    return new Promise((resolve, reject) => {
        const handler = (data) => {
            try {
                const response = JSON.parse(data);
                if (response.type === 'admin_query_response') {
                    ws.removeListener('message', handler);
                    resolve(response.payload);
                } else if (response.type === 'admin_update_response') {
                    ws.removeListener('message', handler);
                    resolve(response.payload);
                }
            } catch (e) { /* ignore non-JSON */ }
        };
        ws.on('message', handler);

        const isUpdate = sql.trim().toUpperCase().startsWith('UPDATE');
        ws.send(JSON.stringify({
            type: isUpdate ? 'admin_update' : 'admin_query',
            payload: { secret: ADMIN_SECRET, sql }
        }));
    });
}

async function main() {
    console.log(`Connecting to ${SERVER_URL}...`);
    const ws = new WebSocket(SERVER_URL);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log('Connected.\n');

    // Step 1: Verify current state
    console.log('=== Step 1: Verify current state ===');
    const playerResult = await sendQuery(ws,
        `SELECT p.username, pd.faction_id FROM players p JOIN player_data pd ON p.id = pd.player_id WHERE p.id = '${PLAYER_ID}'`
    );
    if (!playerResult.success || playerResult.rows.length === 0) {
        console.error('Player not found!', playerResult);
        ws.close();
        process.exit(1);
    }
    console.log(`Player: ${playerResult.rows[0].username}, current faction: ${playerResult.rows[0].faction_id}`);

    // Step 2: Count structures in chunk
    const structResult = await sendQuery(ws,
        `SELECT data::text FROM chunks WHERE chunk_id = '${CHUNK_ID}'`
    );
    if (!structResult.success || structResult.rows.length === 0) {
        console.error('Chunk not found!');
        ws.close();
        process.exit(1);
    }

    const chunkData = JSON.parse(structResult.rows[0].data);
    const ownedStructures = chunkData.objectChanges.filter(
        obj => obj.owner === PLAYER_ID && obj.action === 'add'
    );
    console.log(`Found ${ownedStructures.length} structures owned by mag5 in ${CHUNK_ID}:`);
    for (const s of ownedStructures) {
        console.log(`  - ${s.name} (factionId: ${s.factionId}) at [${s.position?.map(p => Math.round(p)).join(', ')}]`);
    }

    // Step 3: Update player faction + clear home (faction change clears home spawn)
    console.log('\n=== Step 2: Update player faction_id to Southguard (1), clear home ===');
    const updatePlayer = await sendQuery(ws,
        `UPDATE player_data SET faction_id = ${NEW_FACTION}, home_structure_id = NULL, home_position_x = NULL, home_position_z = NULL WHERE player_id = '${PLAYER_ID}'`
    );
    if (!updatePlayer.success) {
        console.error('Failed to update player faction:', updatePlayer.error);
        ws.close();
        process.exit(1);
    }
    console.log(`Updated player_data: ${updatePlayer.rowCount} row(s) affected`);

    // Step 4: Update chunk data - change factionId on all owned structures
    console.log('\n=== Step 3: Update structure factionIds in chunk data ===');
    let changed = 0;
    for (const obj of chunkData.objectChanges) {
        if (obj.owner === PLAYER_ID && obj.action === 'add' && obj.factionId !== undefined) {
            obj.factionId = NEW_FACTION;
            changed++;
        }
    }
    console.log(`Changed factionId on ${changed} structures in JSON`);

    // Write updated chunk data back
    const escapedJson = JSON.stringify(JSON.stringify(chunkData)).slice(1, -1); // escape for SQL
    const updateChunk = await sendQuery(ws,
        `UPDATE chunks SET data = '${escapedJson}', updated_at = NOW() WHERE chunk_id = '${CHUNK_ID}'`
    );
    if (!updateChunk.success) {
        console.error('Failed to update chunk data:', updateChunk.error);
        ws.close();
        process.exit(1);
    }
    console.log(`Updated chunk: ${updateChunk.rowCount} row(s) affected`);

    // Step 5: Verify
    console.log('\n=== Step 4: Verify changes ===');
    const verifyPlayer = await sendQuery(ws,
        `SELECT p.username, pd.faction_id FROM players p JOIN player_data pd ON p.id = pd.player_id WHERE p.id = '${PLAYER_ID}'`
    );
    console.log(`Player faction now: ${verifyPlayer.rows[0].faction_id} (expected: ${NEW_FACTION})`);

    const verifyChunk = await sendQuery(ws,
        `SELECT data::text FROM chunks WHERE chunk_id = '${CHUNK_ID}'`
    );
    const newChunkData = JSON.parse(verifyChunk.rows[0].data);
    const verifyStructs = newChunkData.objectChanges.filter(
        obj => obj.owner === PLAYER_ID && obj.action === 'add'
    );
    for (const s of verifyStructs) {
        console.log(`  ${s.name}: factionId = ${s.factionId} (expected: ${NEW_FACTION})`);
    }

    console.log('\nDone! mag5 is now Southguard.');
    console.log('NOTE: mag5 needs to relog for changes to take effect in-game.');
    ws.close();
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

setTimeout(() => {
    console.error('Timeout after 60s');
    process.exit(1);
}, 60000);

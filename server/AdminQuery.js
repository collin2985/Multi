/**
 * AdminQuery.js
 * CLI tool to run SELECT queries against the production database via WebSocket
 *
 * Usage:
 *   node server/AdminQuery.js "SELECT ..."
 *   node server/AdminQuery.js --hours 4              (audit log summary)
 *   node server/AdminQuery.js --hours 4 --player bob (filtered)
 *
 * Requires ADMIN_SECRET in .env file
 */

const WebSocket = require('ws');
require('dotenv').config();

const ACTION_NAMES = {
    1: 'STRUCT_ADD', 2: 'STRUCT_REMOVE', 3: 'INV_OPEN', 4: 'INV_SAVE',
    5: 'MARKET_BUY', 6: 'MARKET_SELL', 7: 'CONNECT', 8: 'DISCONNECT',
    9: 'CHUNK_ENTER', 10: 'HARVEST', 11: 'FP_CHECK', 12: 'FP_BAN'
};

// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--hours' && args[i + 1]) {
            options.hours = parseInt(args[++i], 10);
        } else if (args[i] === '--player' && args[i + 1]) {
            options.player = args[++i];
        } else if (args[i] === '--limit' && args[i + 1]) {
            options.limit = parseInt(args[++i], 10);
        } else if (!args[i].startsWith('--')) {
            options.sql = args[i];
        }
    }
    return options;
}

// Build SQL from shortcut options
function buildSQL(options) {
    if (options.sql) return options.sql;

    if (options.hours) {
        const cutoffMs = Date.now() - (options.hours * 60 * 60 * 1000);
        let where = `ts > ${cutoffMs}`;
        if (options.player) where += ` AND LOWER(actor_name) = LOWER('${options.player.replace(/'/g, "''")}')`;
        const limit = options.limit || 500;
        return `SELECT ts, action_type, obj_type, actor_name, chunk_x, chunk_z, data FROM audit_log WHERE ${where} ORDER BY ts DESC LIMIT ${limit}`;
    }

    return null;
}

// Format audit log results nicely
function formatAuditResults(rows) {
    if (rows.length === 0) {
        console.log('No results.');
        return;
    }

    // Check if these are audit_log rows
    const isAuditLog = rows[0].hasOwnProperty('action_type') && rows[0].hasOwnProperty('actor_name');

    if (!isAuditLog) {
        // Generic table output
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    // Player summary
    const players = {};
    for (const r of rows) {
        const name = r.actor_name || '(guest)';
        if (!players[name]) players[name] = { count: 0, first: r.ts, last: r.ts, actions: {} };
        players[name].count++;
        if (Number(r.ts) < Number(players[name].first)) players[name].first = r.ts;
        if (Number(r.ts) > Number(players[name].last)) players[name].last = r.ts;
        const aName = ACTION_NAMES[r.action_type] || String(r.action_type);
        players[name].actions[aName] = (players[name].actions[aName] || 0) + 1;
    }

    console.log('\n=== PLAYER SUMMARY ===');
    const sorted = Object.entries(players).sort((a, b) => b[1].count - a[1].count);
    for (const [name, stats] of sorted) {
        const first = new Date(Number(stats.first)).toISOString().substr(11, 8);
        const last = new Date(Number(stats.last)).toISOString().substr(11, 8);
        const breakdown = Object.entries(stats.actions).map(([k, v]) => `${k}:${v}`).join(', ');
        console.log(`  ${name}: ${stats.count} actions (${first} - ${last}) [${breakdown}]`);
    }

    // Action breakdown
    const actionCounts = {};
    for (const r of rows) {
        const aName = ACTION_NAMES[r.action_type] || String(r.action_type);
        actionCounts[aName] = (actionCounts[aName] || 0) + 1;
    }
    console.log('\n=== ACTION BREAKDOWN ===');
    for (const [action, count] of Object.entries(actionCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${action}: ${count}`);
    }

    // Recent notable events
    const notable = rows.filter(r => [1, 2, 5, 6, 7, 8].includes(r.action_type)).slice(0, 30);
    if (notable.length > 0) {
        console.log('\n=== RECENT EVENTS (connects, structures, market) ===');
        for (const r of notable) {
            const time = new Date(Number(r.ts)).toISOString().substr(11, 8);
            const name = r.actor_name || '(guest)';
            const action = ACTION_NAMES[r.action_type];
            const obj = r.obj_type || '';
            console.log(`  [${time}] ${action} | ${name} | ${obj} (${r.chunk_x},${r.chunk_z})`);
        }
    }

    console.log(`\nTotal: ${rows.length} rows`);
}

// Main
const options = parseArgs();
const sql = buildSQL(options);

if (!sql) {
    console.error('Usage:');
    console.error('  node server/AdminQuery.js "SELECT ..."');
    console.error('  node server/AdminQuery.js --hours 4');
    console.error('  node server/AdminQuery.js --hours 4 --player bob');
    process.exit(1);
}

const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
    console.error('Error: ADMIN_SECRET not found in .env file');
    process.exit(1);
}

const SERVER_URL = 'wss://multiplayer-game-dcwy.onrender.com';
console.log(`Connecting to ${SERVER_URL}...`);

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
    console.log('Connected. Running query...');
    ws.send(JSON.stringify({
        type: 'admin_query',
        payload: { secret: ADMIN_SECRET, sql }
    }));
});

ws.on('message', (data) => {
    try {
        const response = JSON.parse(data);
        if (response.type === 'admin_query_response') {
            if (response.payload.success) {
                formatAuditResults(response.payload.rows);
            } else {
                console.error(`Query failed: ${response.payload.error}`);
            }
            ws.close();
            process.exit(response.payload.success ? 0 : 1);
        }
    } catch (e) {
        // Ignore other messages (welcome, etc.)
    }
});

ws.on('error', (error) => {
    console.error('Connection error:', error.message);
    process.exit(1);
});

ws.on('close', () => {});

setTimeout(() => {
    console.error('Timeout: No response from server after 30s');
    ws.close();
    process.exit(1);
}, 30000);

#!/usr/bin/env node
/**
 * AuditQuery.js
 * CLI tool for querying audit logs from PostgreSQL (online mode)
 * Outputs AI-friendly formatted data for analysis
 *
 * Usage:
 *   node server/AuditQuery.js [options]
 *
 * Options:
 *   --player <name>      Filter by player name
 *   --account <id>       Filter by account ID
 *   --action <type>      Filter by action type (add, remove, harvest, connect, etc.)
 *   --chunk <x,z>        Filter by chunk coordinates
 *   --hours <n>          Only show last N hours (default: 24)
 *   --limit <n>          Maximum entries to return (default: 500)
 *   --format <type>      Output format: summary (default), json, timeline
 *   --obj <id>           Filter by object ID
 *   --suspicious         Flag potentially suspicious activity
 */

require('dotenv').config();
const { Pool } = require('pg');

// Action type mapping
const ACTION_TYPES = {
    1: { name: 'STRUCT_ADD', label: 'Structure Placed', icon: '+' },
    2: { name: 'STRUCT_REMOVE', label: 'Structure Removed', icon: '-' },
    3: { name: 'INV_OPEN', label: 'Inventory Opened', icon: 'O' },
    4: { name: 'INV_SAVE', label: 'Inventory Saved', icon: 'S' },
    5: { name: 'MARKET_BUY', label: 'Market Purchase', icon: '$' },
    6: { name: 'MARKET_SELL', label: 'Market Sale', icon: '$' },
    7: { name: 'PLAYER_CONNECT', label: 'Player Connected', icon: '>' },
    8: { name: 'PLAYER_DISCONNECT', label: 'Player Disconnected', icon: '<' },
    9: { name: 'CHUNK_ENTER', label: 'Entered Chunk', icon: '@' },
    10: { name: 'HARVEST', label: 'Resource Harvested', icon: 'H' }
};

// Reverse mapping for CLI args
const ACTION_NAME_TO_TYPE = {
    'add': 1, 'struct_add': 1, 'place': 1, 'build': 1,
    'remove': 2, 'struct_remove': 2, 'destroy': 2, 'chop': 2,
    'open': 3, 'inv_open': 3,
    'save': 4, 'inv_save': 4,
    'buy': 5, 'market_buy': 5, 'purchase': 5,
    'sell': 6, 'market_sell': 6,
    'connect': 7, 'login': 7, 'join': 7,
    'disconnect': 8, 'logout': 8, 'leave': 8,
    'enter': 9, 'chunk': 9, 'move': 9,
    'harvest': 10, 'gather': 10
};

class AuditQuery {
    constructor() {
        this.pool = null;
    }

    async connect() {
        if (!process.env.DATABASE_URL) {
            console.error('ERROR: DATABASE_URL not set. This tool requires online mode (PostgreSQL).');
            console.error('Set DATABASE_URL in .env file or environment variable.');
            process.exit(1);
        }

        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        try {
            const client = await this.pool.connect();
            client.release();
        } catch (error) {
            console.error('ERROR: Could not connect to database:', error.message);
            process.exit(1);
        }
    }

    async query(options) {
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        // Time filter
        const hours = options.hours || 24;
        const cutoffTs = Date.now() - (hours * 60 * 60 * 1000);
        conditions.push(`ts >= $${paramIndex++}`);
        params.push(cutoffTs);

        // Player name filter
        if (options.player) {
            conditions.push(`LOWER(actor_name) = LOWER($${paramIndex++})`);
            params.push(options.player);
        }

        // Account ID filter
        if (options.account) {
            conditions.push(`actor_account = $${paramIndex++}`);
            params.push(options.account);
        }

        // Action type filter
        if (options.action) {
            const actionType = ACTION_NAME_TO_TYPE[options.action.toLowerCase()];
            if (actionType) {
                conditions.push(`action_type = $${paramIndex++}`);
                params.push(actionType);
            }
        }

        // Chunk filter
        if (options.chunk) {
            const [x, z] = options.chunk.split(',').map(Number);
            conditions.push(`chunk_x = $${paramIndex++} AND chunk_z = $${paramIndex++}`);
            params.push(x, z);
        }

        // Object ID filter
        if (options.obj) {
            conditions.push(`obj_id LIKE $${paramIndex++}`);
            params.push(`%${options.obj}%`);
        }

        const limit = options.limit || 500;
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT ts, action_type, chunk_x, chunk_z, obj_type, obj_id,
                   actor_id, actor_account, actor_name, owner_id, data
            FROM audit_log
            ${whereClause}
            ORDER BY ts DESC
            LIMIT $${paramIndex}
        `;
        params.push(limit);

        const result = await this.pool.query(sql, params);
        return result.rows;
    }

    formatEntry(entry) {
        const action = ACTION_TYPES[entry.action_type] || { name: 'UNKNOWN', label: 'Unknown', icon: '?' };
        const time = new Date(Number(entry.ts)).toISOString();
        const player = entry.actor_name || entry.actor_account || entry.actor_id || 'unknown';
        const chunk = entry.chunk_x != null ? `(${entry.chunk_x}, ${entry.chunk_z})` : '';

        return {
            time,
            action: action.name,
            actionLabel: action.label,
            player,
            account: entry.actor_account,
            chunk,
            objectType: entry.obj_type,
            objectId: entry.obj_id,
            ownerId: entry.owner_id,
            data: entry.data,
            raw: entry
        };
    }

    // Detect potentially suspicious patterns
    analyzeSuspicious(entries) {
        const suspicious = [];
        const playerActions = {};
        const chunkAccess = {};

        for (const entry of entries) {
            const formatted = this.formatEntry(entry);
            const player = formatted.player;
            const account = formatted.account;

            // Track per-player actions
            if (!playerActions[player]) {
                playerActions[player] = { removes: 0, harvests: 0, invOpens: 0, chunks: new Set() };
            }

            const pa = playerActions[player];

            if (entry.action_type === 2) pa.removes++;
            if (entry.action_type === 10) pa.harvests++;
            if (entry.action_type === 3) pa.invOpens++;
            if (entry.chunk_x != null) pa.chunks.add(`${entry.chunk_x},${entry.chunk_z}`);

            // Track who accessed what structures
            if (entry.action_type === 3 && entry.owner_id && entry.owner_id !== account) {
                if (!chunkAccess[entry.obj_id]) chunkAccess[entry.obj_id] = [];
                chunkAccess[entry.obj_id].push({ player, account, time: formatted.time, owner: entry.owner_id });
            }
        }

        // Flag players with unusual activity
        for (const [player, stats] of Object.entries(playerActions)) {
            if (stats.removes > 50) {
                suspicious.push({
                    type: 'HIGH_REMOVAL_COUNT',
                    player,
                    detail: `Removed ${stats.removes} structures`,
                    severity: 'medium'
                });
            }
            if (stats.invOpens > 30) {
                suspicious.push({
                    type: 'HIGH_INVENTORY_ACCESS',
                    player,
                    detail: `Opened ${stats.invOpens} inventories`,
                    severity: 'low'
                });
            }
            if (stats.chunks.size > 20) {
                suspicious.push({
                    type: 'RAPID_MOVEMENT',
                    player,
                    detail: `Visited ${stats.chunks.size} different chunks`,
                    severity: 'low'
                });
            }
        }

        // Flag accessing other players' inventories
        for (const [objId, accesses] of Object.entries(chunkAccess)) {
            if (accesses.length >= 1) {
                for (const access of accesses) {
                    suspicious.push({
                        type: 'OTHER_PLAYER_INVENTORY',
                        player: access.player,
                        detail: `Accessed inventory owned by ${access.owner} at ${access.time}`,
                        objectId: objId,
                        severity: 'info'
                    });
                }
            }
        }

        return suspicious;
    }

    outputSummary(entries, options) {
        const formatted = entries.map(e => this.formatEntry(e)).reverse(); // chronological

        console.log('\n=== AUDIT LOG SUMMARY ===\n');
        console.log(`Period: Last ${options.hours || 24} hours`);
        console.log(`Entries: ${entries.length}`);

        // Player summary
        const playerStats = {};
        for (const e of formatted) {
            if (!playerStats[e.player]) {
                playerStats[e.player] = { actions: 0, types: {} };
            }
            playerStats[e.player].actions++;
            const actionName = e.action;
            playerStats[e.player].types[actionName] = (playerStats[e.player].types[actionName] || 0) + 1;
        }

        console.log('\n--- Player Activity ---');
        for (const [player, stats] of Object.entries(playerStats)) {
            const breakdown = Object.entries(stats.types)
                .map(([type, count]) => `${type}:${count}`)
                .join(', ');
            console.log(`  ${player}: ${stats.actions} actions (${breakdown})`);
        }

        // Chunk activity
        const chunkStats = {};
        for (const e of formatted) {
            if (e.chunk) {
                chunkStats[e.chunk] = (chunkStats[e.chunk] || 0) + 1;
            }
        }

        console.log('\n--- Active Chunks (top 10) ---');
        const topChunks = Object.entries(chunkStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        for (const [chunk, count] of topChunks) {
            console.log(`  ${chunk}: ${count} events`);
        }

        // Suspicious activity
        if (options.suspicious) {
            const suspicious = this.analyzeSuspicious(entries);
            if (suspicious.length > 0) {
                console.log('\n--- Flagged Activity ---');
                for (const s of suspicious) {
                    console.log(`  [${s.severity.toUpperCase()}] ${s.type}: ${s.player} - ${s.detail}`);
                }
            } else {
                console.log('\n--- No suspicious activity detected ---');
            }
        }

        // Recent timeline (last 20 events)
        console.log('\n--- Recent Events (last 20) ---');
        const recent = formatted.slice(-20);
        for (const e of recent) {
            const time = e.time.split('T')[1].split('.')[0]; // HH:MM:SS
            const obj = e.objectType ? ` [${e.objectType}]` : '';
            const chunk = e.chunk ? ` @ ${e.chunk}` : '';
            console.log(`  ${time} | ${e.player.padEnd(15)} | ${e.actionLabel}${obj}${chunk}`);
        }

        console.log('\n=== END SUMMARY ===\n');
    }

    outputJSON(entries, options) {
        const formatted = entries.map(e => this.formatEntry(e)).reverse();

        const output = {
            query: {
                hours: options.hours || 24,
                player: options.player || null,
                action: options.action || null,
                chunk: options.chunk || null,
                limit: options.limit || 500
            },
            stats: {
                totalEntries: entries.length,
                timeRange: entries.length > 0 ? {
                    from: new Date(Number(entries[entries.length - 1].ts)).toISOString(),
                    to: new Date(Number(entries[0].ts)).toISOString()
                } : null
            },
            entries: formatted.map(e => ({
                time: e.time,
                action: e.action,
                player: e.player,
                account: e.account,
                chunk: e.chunk,
                objectType: e.objectType,
                objectId: e.objectId,
                ownerId: e.ownerId,
                data: e.data
            }))
        };

        if (options.suspicious) {
            output.suspicious = this.analyzeSuspicious(entries);
        }

        console.log(JSON.stringify(output, null, 2));
    }

    outputTimeline(entries, options) {
        const formatted = entries.map(e => this.formatEntry(e)).reverse();

        console.log('\n=== AUDIT TIMELINE ===\n');

        let currentDay = '';
        for (const e of formatted) {
            const [date, timePart] = e.time.split('T');
            const time = timePart.split('.')[0];

            if (date !== currentDay) {
                currentDay = date;
                console.log(`\n--- ${date} ---\n`);
            }

            const action = ACTION_TYPES[e.raw.action_type] || { icon: '?' };
            const obj = e.objectType ? ` ${e.objectType}` : '';
            const chunk = e.chunk ? ` @ ${e.chunk}` : '';
            const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : '';

            console.log(`${time} [${action.icon}] ${e.player}: ${e.actionLabel}${obj}${chunk}${dataStr}`);
        }

        console.log('\n=== END TIMELINE ===\n');
    }

    async findPartialMatches(fingerprintHash, threshold = 2) {
        // Get target fingerprint's partial hashes
        const targetResult = await this.pool.query(
            `SELECT partial_hashes, associated_names FROM fingerprint_sightings WHERE fingerprint_hash = $1`,
            [fingerprintHash]
        );

        if (targetResult.rows.length === 0) {
            console.log(`Fingerprint ${fingerprintHash.substring(0, 16)}... not found in sightings`);
            return [];
        }

        const targetPartials = targetResult.rows[0].partial_hashes || {};
        console.log(`\nSearching for matches to: ${fingerprintHash.substring(0, 16)}...`);
        console.log(`Known as: ${(targetResult.rows[0].associated_names || []).join(', ') || 'Unknown'}`);
        console.log(`Target partials: gpu=${targetPartials.gpu?.substring(0,8) || 'N/A'}, hardware=${targetPartials.hardware?.substring(0,8) || 'N/A'}, canvas=${targetPartials.canvas?.substring(0,8) || 'N/A'}`);
        console.log(`Match threshold: ${threshold}+ signals\n`);

        // Get all other fingerprints
        const allResult = await this.pool.query(
            `SELECT fingerprint_hash, partial_hashes, associated_names, associated_accounts,
                    connection_count, last_seen
             FROM fingerprint_sightings
             WHERE fingerprint_hash != $1`,
            [fingerprintHash]
        );

        const matches = [];
        for (const row of allResult.rows) {
            const otherPartials = row.partial_hashes || {};
            let matchCount = 0;
            const matchedSignals = [];

            if (targetPartials.gpu && otherPartials.gpu === targetPartials.gpu) {
                matchCount++;
                matchedSignals.push('gpu');
            }
            if (targetPartials.hardware && otherPartials.hardware === targetPartials.hardware) {
                matchCount++;
                matchedSignals.push('hardware');
            }
            if (targetPartials.canvas && otherPartials.canvas === targetPartials.canvas) {
                matchCount++;
                matchedSignals.push('canvas');
            }

            if (matchCount >= threshold) {
                matches.push({
                    fingerprint: row.fingerprint_hash,
                    matchCount,
                    matchedSignals,
                    names: row.associated_names || [],
                    accounts: row.associated_accounts || [],
                    connectionCount: row.connection_count,
                    lastSeen: row.last_seen
                });
            }
        }

        // Sort by match count descending
        matches.sort((a, b) => b.matchCount - a.matchCount);

        // Output results
        if (matches.length === 0) {
            console.log('No matching fingerprints found.');
        } else {
            console.log(`Found ${matches.length} potential match(es):\n`);
            for (const m of matches) {
                console.log(`Fingerprint: ${m.fingerprint.substring(0, 16)}...`);
                console.log(`  Matches: ${m.matchCount}/3 signals (${m.matchedSignals.join(', ')})`);
                console.log(`  Names: ${m.names.join(', ') || 'Unknown'}`);
                console.log(`  Connections: ${m.connectionCount}`);
                console.log(`  Last seen: ${m.lastSeen ? new Date(m.lastSeen).toISOString() : 'Unknown'}`);
                console.log('');
            }
        }

        return matches;
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}

// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (key === 'suspicious') {
                options.suspicious = true;
            } else if (key === 'partial-match' && i + 1 < args.length) {
                options.partialMatch = args[++i];
            } else if (key === 'threshold' && i + 1 < args.length) {
                options.matchThreshold = parseInt(args[++i], 10) || 2;
            } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                options[key] = args[++i];
            }
        }
    }

    // Convert numeric options
    if (options.hours) options.hours = parseInt(options.hours, 10);
    if (options.limit) options.limit = parseInt(options.limit, 10);

    return options;
}

// Main
async function main() {
    const options = parseArgs();

    if (options.help) {
        console.log(`
AuditQuery - Query audit logs from PostgreSQL (online mode)

Usage: node server/AuditQuery.js [options]

Options:
  --player <name>      Filter by player name
  --account <id>       Filter by account ID
  --action <type>      Filter by action: add, remove, harvest, connect, disconnect,
                       buy, sell, open, save, enter
  --chunk <x,z>        Filter by chunk coordinates (e.g., --chunk 100,-50)
  --hours <n>          Time window in hours (default: 24)
  --limit <n>          Max entries to return (default: 500)
  --format <type>      Output: summary (default), json, timeline
  --obj <id>           Filter by object ID (partial match)
  --suspicious         Analyze and flag suspicious patterns
  --partial-match <hash>  Find similar fingerprints (ban evasion detection)
  --threshold <n>      Match threshold for partial-match (default: 2)

Examples:
  node server/AuditQuery.js --player bob --hours 48
  node server/AuditQuery.js --action harvest --format json
  node server/AuditQuery.js --suspicious --hours 12
  node server/AuditQuery.js --chunk 100,-50 --format timeline
        `);
        process.exit(0);
    }

    const query = new AuditQuery();
    await query.connect();

    // Handle partial-match command
    if (options.partialMatch) {
        await query.findPartialMatches(options.partialMatch, options.matchThreshold || 2);
        await query.close();
        return;
    }

    try {
        const entries = await query.query(options);

        if (entries.length === 0) {
            console.log('No audit entries found matching the criteria.');
            return;
        }

        const format = options.format || 'summary';

        switch (format) {
            case 'json':
                query.outputJSON(entries, options);
                break;
            case 'timeline':
                query.outputTimeline(entries, options);
                break;
            default:
                query.outputSummary(entries, options);
        }
    } finally {
        await query.close();
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * BanPlayer.js
 * CLI tool for banning players by fingerprint
 *
 * Usage:
 *   node server/BanPlayer.js <username> --reason "reason for ban"
 *   node server/BanPlayer.js fingerprint <hash> --reason "reason"  # Ban by fingerprint hash
 *   node server/BanPlayer.js list                    # List all banned fingerprints
 *   node server/BanPlayer.js unban <id>              # Unban by fingerprint ID
 *   node server/BanPlayer.js check <username>        # Check if player would be banned
 */

const db = require('./DatabaseManager');

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showHelp();
        process.exit(1);
    }

    const command = args[0];

    // Connect to database
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL environment variable not set');
        console.error('This tool requires a database connection.');
        process.exit(1);
    }

    try {
        await db.connectWithRetry();
    } catch (error) {
        console.error('Failed to connect to database:', error.message);
        process.exit(1);
    }

    try {
        switch (command) {
            case 'list':
                await listBans();
                break;
            case 'unban':
                if (!args[1]) {
                    console.error('Usage: node server/BanPlayer.js unban <id>');
                    process.exit(1);
                }
                await unban(args[1]);
                break;
            case 'check':
                if (!args[1]) {
                    console.error('Usage: node server/BanPlayer.js check <username>');
                    process.exit(1);
                }
                await checkPlayer(args[1]);
                break;
            case 'fingerprint':
                if (!args[1]) {
                    console.error('Usage: node server/BanPlayer.js fingerprint <hash> --reason "reason"');
                    process.exit(1);
                }
                // Parse --reason flag
                let fpReason = 'No reason provided';
                const fpReasonIndex = args.findIndex(a => a === '--reason' || a === '-r');
                if (fpReasonIndex !== -1 && args[fpReasonIndex + 1]) {
                    fpReason = args[fpReasonIndex + 1];
                }
                await banFingerprintDirect(args[1], fpReason);
                break;
            case 'help':
            case '--help':
            case '-h':
                showHelp();
                break;
            default:
                // Assume it's a username to ban
                await banPlayer(args);
                break;
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }

    await db.close();
}

function showHelp() {
    console.log(`
BanPlayer - Fingerprint Ban Management Tool

USAGE:
  node server/BanPlayer.js <username> --reason "reason"           Ban a player by username
  node server/BanPlayer.js fingerprint <hash> --reason "reason"   Ban by fingerprint hash
  node server/BanPlayer.js list                                   List all bans
  node server/BanPlayer.js unban <id>                             Remove a ban
  node server/BanPlayer.js check <username>                       Check player status

EXAMPLES:
  node server/BanPlayer.js cheater123 --reason "Speed hacking"
  node server/BanPlayer.js fingerprint abc123def456... --reason "Guest ban evasion"
  node server/BanPlayer.js list
  node server/BanPlayer.js unban 5
  node server/BanPlayer.js check suspiciousPlayer

OPTIONS:
  --reason, -r    Reason for the ban (required when banning)
`);
}

async function banPlayer(args) {
    const username = args[0];

    // Parse --reason flag
    let reason = 'No reason provided';
    const reasonIndex = args.findIndex(a => a === '--reason' || a === '-r');
    if (reasonIndex !== -1 && args[reasonIndex + 1]) {
        reason = args[reasonIndex + 1];
    }

    console.log(`Looking up player: ${username}`);

    // Find player
    const playerResult = await db.query(
        `SELECT id, username, fingerprint_hash, fingerprint_signals
         FROM players WHERE LOWER(username) = LOWER($1)`,
        [username]
    );

    if (playerResult.rows.length === 0) {
        console.error(`Player "${username}" not found`);
        process.exit(1);
    }

    const player = playerResult.rows[0];

    if (!player.fingerprint_hash) {
        console.error(`Player "${player.username}" has no fingerprint recorded`);
        console.error('They need to login at least once for fingerprint to be collected.');
        process.exit(1);
    }

    // Check if already banned
    const existingBan = await db.query(
        `SELECT id FROM banned_fingerprints
         WHERE fingerprint_hash = $1 AND is_active = TRUE`,
        [player.fingerprint_hash]
    );

    if (existingBan.rows.length > 0) {
        console.error(`Player "${player.username}" is already banned (ban ID: ${existingBan.rows[0].id})`);
        process.exit(1);
    }

    // Insert ban
    const partialHashes = player.fingerprint_signals || {};

    const result = await db.query(
        `INSERT INTO banned_fingerprints
         (fingerprint_hash, partial_hashes, banned_by, reason, original_account_id, original_username)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
            player.fingerprint_hash,
            JSON.stringify(partialHashes),
            'CLI',
            reason,
            player.id,
            player.username
        ]
    );

    console.log('');
    console.log('=== PLAYER BANNED ===');
    console.log(`Username:    ${player.username}`);
    console.log(`Ban ID:      ${result.rows[0].id}`);
    console.log(`Reason:      ${reason}`);
    console.log(`Fingerprint: ${player.fingerprint_hash.substring(0, 16)}...`);
    console.log('');
    console.log('Player will be blocked on next login attempt.');
}

async function listBans() {
    const result = await db.query(
        `SELECT id, original_username, reason, banned_by, banned_at,
                match_count, last_match_at, is_active,
                fingerprint_hash
         FROM banned_fingerprints
         ORDER BY banned_at DESC`
    );

    if (result.rows.length === 0) {
        console.log('No fingerprint bans found.');
        return;
    }

    console.log('');
    console.log('=== BANNED FINGERPRINTS ===');
    console.log('');

    for (const ban of result.rows) {
        const status = ban.is_active ? 'ACTIVE' : 'INACTIVE';
        const lastMatch = ban.last_match_at
            ? new Date(ban.last_match_at).toLocaleDateString()
            : 'never';

        console.log(`[${ban.id}] ${ban.original_username} - ${status}`);
        console.log(`    Reason:      ${ban.reason || 'No reason'}`);
        console.log(`    Banned by:   ${ban.banned_by || 'Unknown'}`);
        console.log(`    Banned at:   ${new Date(ban.banned_at).toLocaleDateString()}`);
        console.log(`    Match count: ${ban.match_count} (last: ${lastMatch})`);
        console.log(`    Hash:        ${ban.fingerprint_hash.substring(0, 16)}...`);
        console.log('');
    }

    console.log(`Total: ${result.rows.length} ban(s)`);
}

async function unban(id) {
    const banId = parseInt(id, 10);
    if (isNaN(banId)) {
        console.error('Invalid ban ID. Must be a number.');
        process.exit(1);
    }

    // Check if ban exists
    const existing = await db.query(
        `SELECT id, original_username, is_active FROM banned_fingerprints WHERE id = $1`,
        [banId]
    );

    if (existing.rows.length === 0) {
        console.error(`Ban ID ${banId} not found`);
        process.exit(1);
    }

    const ban = existing.rows[0];

    if (!ban.is_active) {
        console.log(`Ban ID ${banId} (${ban.original_username}) is already inactive`);
        return;
    }

    // Deactivate the ban (don't delete - keep for records)
    await db.query(
        `UPDATE banned_fingerprints SET is_active = FALSE WHERE id = $1`,
        [banId]
    );

    console.log('');
    console.log('=== BAN REMOVED ===');
    console.log(`Ban ID:   ${banId}`);
    console.log(`Username: ${ban.original_username}`);
    console.log('');
    console.log('Player can now login again.');
}

async function checkPlayer(username) {
    // Find player
    const playerResult = await db.query(
        `SELECT id, username, fingerprint_hash, fingerprint_signals
         FROM players WHERE LOWER(username) = LOWER($1)`,
        [username]
    );

    if (playerResult.rows.length === 0) {
        console.error(`Player "${username}" not found`);
        process.exit(1);
    }

    const player = playerResult.rows[0];

    console.log('');
    console.log(`=== PLAYER: ${player.username} ===`);
    console.log('');

    if (!player.fingerprint_hash) {
        console.log('Fingerprint: NOT RECORDED');
        console.log('Status:      Player has not logged in since fingerprinting was added');
        return;
    }

    console.log(`Fingerprint: ${player.fingerprint_hash.substring(0, 16)}...`);

    // Check for exact ban
    const exactBan = await db.query(
        `SELECT id, reason, banned_at FROM banned_fingerprints
         WHERE fingerprint_hash = $1 AND is_active = TRUE`,
        [player.fingerprint_hash]
    );

    if (exactBan.rows.length > 0) {
        const ban = exactBan.rows[0];
        console.log('Status:      BANNED (exact match)');
        console.log(`Ban ID:      ${ban.id}`);
        console.log(`Reason:      ${ban.reason}`);
        console.log(`Banned at:   ${new Date(ban.banned_at).toLocaleDateString()}`);
        return;
    }

    // Check for partial matches
    const partials = player.fingerprint_signals || {};
    const allBans = await db.query(
        `SELECT id, original_username, partial_hashes FROM banned_fingerprints WHERE is_active = TRUE`
    );

    let partialMatches = [];
    for (const ban of allBans.rows) {
        const storedPartials = ban.partial_hashes || {};
        let matchCount = 0;
        if (storedPartials.gpu && storedPartials.gpu === partials.gpu) matchCount++;
        if (storedPartials.hardware && storedPartials.hardware === partials.hardware) matchCount++;
        if (storedPartials.canvas && storedPartials.canvas === partials.canvas) matchCount++;

        if (matchCount >= 2) {
            partialMatches.push({ ...ban, matchCount });
        }
    }

    if (partialMatches.length > 0) {
        console.log('Status:      FLAGGED (partial matches)');
        console.log('');
        console.log('Similar to banned players:');
        for (const match of partialMatches) {
            console.log(`  - ${match.original_username} (${match.matchCount}/3 signals match)`);
        }
    } else {
        console.log('Status:      CLEAR');
        console.log('             No bans or partial matches found.');
    }
}

async function banFingerprintDirect(hash, reason) {
    // Validate hash format (64-char hex)
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
        console.error('Invalid fingerprint hash. Must be 64 hex characters.');
        process.exit(1);
    }

    // Check if already banned
    const existing = await db.query(
        `SELECT id FROM banned_fingerprints WHERE fingerprint_hash = $1 AND is_active = TRUE`,
        [hash]
    );

    if (existing.rows.length > 0) {
        console.error(`Fingerprint already banned (ban ID: ${existing.rows[0].id})`);
        process.exit(1);
    }

    // Find any accounts associated with this fingerprint (for logging)
    const accounts = await db.query(
        `SELECT username FROM players WHERE fingerprint_hash = $1`,
        [hash]
    );

    // Also check fingerprint_sightings for associated names
    const sightings = await db.query(
        `SELECT associated_names FROM fingerprint_sightings WHERE fingerprint_hash = $1`,
        [hash]
    );

    let originalUsername = 'Guest (no account)';
    if (accounts.rows.length > 0) {
        originalUsername = accounts.rows.map(r => r.username).join(', ');
    } else if (sightings.rows.length > 0 && sightings.rows[0].associated_names?.length > 0) {
        originalUsername = sightings.rows[0].associated_names.join(', ');
    }

    // Insert ban
    const result = await db.query(
        `INSERT INTO banned_fingerprints (fingerprint_hash, banned_by, reason, original_username)
         VALUES ($1, 'CLI', $2, $3)
         RETURNING id`,
        [hash, reason, originalUsername]
    );

    console.log('');
    console.log('=== FINGERPRINT BANNED ===');
    console.log(`Ban ID:      ${result.rows[0].id}`);
    console.log(`Fingerprint: ${hash.substring(0, 16)}...`);
    console.log(`Reason:      ${reason}`);
    console.log(`Associated:  ${originalUsername}`);
    console.log('');
    console.log('Note: Ban takes effect on next server cache refresh (~60 seconds)');
    console.log('      or immediately for new connections.');
}

main().catch(console.error);

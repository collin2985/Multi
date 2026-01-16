# Horses Game - Project Rules

## Read First (Every Session)
Before starting work, read these files for context:
1. **GAME_CONTEXT.md** - Architecture, systems, current state
2. **CODEFILE_GUIDE.md** - File locations and organization

## Moderation Tools

### Query Player Logs (Online Database)

**Important:** Always write queries to a `.js` file and run with `node filename.js`. Do NOT use inline `node -e` - it has shell escaping issues on Windows.

1. Read `DATABASE_URL` from `.env` file
2. Write query to a temp file (e.g., `query-temp.js`)
3. Run with `node query-temp.js`

**audit_log table schema:**
```
id: integer
ts: bigint (milliseconds timestamp)
action_type: smallint
chunk_x: smallint
chunk_z: smallint (NOTE: Z not Y)
obj_type: varchar
obj_id: varchar
actor_id: varchar (session ID)
actor_account: varchar
actor_name: varchar (player display name)
owner_id: varchar
data: jsonb
```

**Action types:** 1=STRUCT_ADD, 2=STRUCT_REMOVE, 3=INV_OPEN, 4=INV_SAVE, 5=MARKET_BUY, 6=MARKET_SELL, 7=CONNECT, 8=DISCONNECT, 9=CHUNK_ENTER, 10=HARVEST, 11=FP_CHECK, 12=FP_BAN

**Example query file:**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'DATABASE_URL_FROM_ENV',
  ssl: { rejectUnauthorized: false }
});

async function query() {
  const result = await pool.query(`
    SELECT ts, action_type, obj_type, actor_name, data
    FROM audit_log
    WHERE chunk_x = 21 AND chunk_z = 12
    ORDER BY ts DESC LIMIT 20
  `);
  result.rows.forEach(r => {
    const date = new Date(Number(r.ts)).toISOString();
    console.log(`[${date}] ${r.action_type} | ${r.obj_type} | ${r.actor_name}`);
  });
  await pool.end();
}
query();
```

### Ban a Player (Hardware Fingerprint)
```bash
set DATABASE_URL=<from .env>
node server/BanPlayer.js <username> --reason "reason"
node server/BanPlayer.js list
node server/BanPlayer.js unban <id>
```

See GAME_CONTEXT.md "Ban System" section for details.

### Admin Broadcast (Send Message to All Players)
Send a big announcement to all connected players. Displays centered on screen for 10 seconds.

```bash
node server/AdminBroadcast.js "Your message here"
```

**Examples:**
```bash
node server/AdminBroadcast.js "Server restarting in 5 minutes!"
node server/AdminBroadcast.js "New update: Check out the new fishing system!"
```

Requires `ADMIN_SECRET` in `.env` file (and in Render environment variables for production).

## Rules

### File Navigation
- Use CODEFILE_GUIDE.md to locate files. Do not grep/search blindly unless you can't find what you're looking for.

### Code Reuse
- Use existing code systems before implementing new systems unless it will cause the file to be over 20k tokens or impact performance.

### Performance
- Be PERFORMANCE MINDED - this is a real-time multiplayer game.
- Server should be used as a last resort. Keep as much stuff client-side as possible to reduce strain on server.

### Style
- No emojis in text in the game.

### File Size Limits
- Keep code files under 2000 lines (including existing ones).
- Keep GAME_CONTEXT.md under 20k tokens.
- Keep CODEFILE_GUIDE.md mindful of file size.

### Documentation Updates
- Document changes in GAME_CONTEXT.md if you changed something important.
- After adding, renaming, or deleting code files, update CODEFILE_GUIDE.md following the format in its "Maintaining This Guide" section.

### Deployment
- When deploying, increment `SERVER_VERSION` in `server.js` (line 25) in BOTH directories (`test horses/horses` and `Desktop/horses`).

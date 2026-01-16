const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://horses_db_waj4_user:ZAuhA8fNC1ngqNSrIElLQ7no1dS9iNm1@dpg-d4hibsshg0os738f69f0-a.frankfurt-postgres.render.com/horses_db_waj4',
  ssl: { rejectUnauthorized: false }
});

async function query() {
  // 1. Check crate removal details
  console.log('=== CRATE REMOVAL ===');
  const crateRemoval = await pool.query(`
    SELECT * FROM audit_log WHERE obj_id = 'crate_1768527119061_r86uaqv35' ORDER BY ts DESC
  `);
  crateRemoval.rows.forEach(r => {
    const action = r.action_type === 1 ? 'ADD' : 'REMOVE';
    const date = new Date(Number(r.ts)).toISOString();
    console.log(`[${date}] ${action} | by: ${r.actor_name} | owner: ${r.owner_id}`);
    if (r.data) console.log(`   data: ${JSON.stringify(r.data)}`);
  });

  // 2. Check Wild's recent activity
  console.log('\n=== WILD RECENT ACTIVITY (last 20) ===');
  const wildActivity = await pool.query(`
    SELECT ts, action_type, obj_type, obj_id, chunk_x, chunk_z, data
    FROM audit_log
    WHERE actor_name = 'Wild'
    ORDER BY ts DESC
    LIMIT 20
  `);
  const actionNames = {1:'STRUCT_ADD', 2:'STRUCT_REMOVE', 3:'INV_OPEN', 4:'INV_SAVE', 5:'MARKET_BUY', 6:'MARKET_SELL', 7:'CONNECT', 8:'DISCONNECT', 9:'CHUNK_ENTER', 10:'HARVEST', 11:'FP_CHECK', 12:'FP_BAN'};
  wildActivity.rows.forEach(r => {
    const date = new Date(Number(r.ts)).toISOString();
    console.log(`[${date}] ${actionNames[r.action_type] || r.action_type} | ${r.obj_type || '-'} | chunk: ${r.chunk_x},${r.chunk_z}`);
  });

  // 3. Check who owns that owner_id
  console.log('\n=== OWNER INFO ===');
  const ownerInfo = await pool.query(`
    SELECT DISTINCT actor_name, actor_id FROM audit_log
    WHERE actor_id LIKE '%8768aec6-708e-493d-9457-4f4f6676ab0e%'
    OR owner_id = '8768aec6-708e-493d-9457-4f4f6676ab0e'
    LIMIT 10
  `);
  ownerInfo.rows.forEach(r => console.log(`  ${r.actor_name} (${r.actor_id})`));

  await pool.end();
}
query().catch(e => { console.error(e); process.exit(1); });

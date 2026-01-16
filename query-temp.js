const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://horses_db_waj4_user:ZAuhA8fNC1ngqNSrIElLQ7no1dS9iNm1@dpg-d4hibsshg0os738f69f0-a.frankfurt-postgres.render.com/horses_db_waj4',
  ssl: { rejectUnauthorized: false }
});

async function query() {
  // Check if ANY log STRUCT_REMOVE events exist anywhere
  const result = await pool.query(`
    SELECT COUNT(*) as total, obj_type
    FROM audit_log
    WHERE action_type = 2
    AND obj_type LIKE '%log%'
    GROUP BY obj_type
    LIMIT 20
  `);

  console.log('STRUCT_REMOVE events for log objects (all chunks):');
  if (result.rows.length === 0) {
    console.log('  NONE FOUND - logs are never being removed!');
  } else {
    result.rows.forEach(r => {
      console.log(`  ${r.obj_type}: ${r.total} removals`);
    });
  }

  // Also check recent log activity globally
  const recent = await pool.query(`
    SELECT action_type, COUNT(*) as cnt
    FROM audit_log
    WHERE obj_type LIKE '%log%'
    AND ts > $1
    GROUP BY action_type
    ORDER BY action_type
  `, [Date.now() - 3600000]); // last hour

  console.log('\nLog-related events in last hour:');
  const actionNames = { 1: 'STRUCT_ADD', 2: 'STRUCT_REMOVE', 10: 'HARVEST' };
  recent.rows.forEach(r => {
    console.log(`  ${actionNames[r.action_type] || r.action_type}: ${r.cnt}`);
  });

  await pool.end();
}

query().catch(err => {
  console.error('Query error:', err);
  pool.end();
});

// Direct PostgreSQL audit — no auth needed
// Run: node audit_db.js

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://fois_user:fois_password@localhost:5432/fois_db'
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('=== DIRECT DB AUDIT ===\n');

    // 1. Total row count
    const total = await client.query('SELECT COUNT(*) FROM freight_movements');
    console.log('Total rows in freight_movements:', total.rows[0].count);

    // 2. movement_type distribution (exact values stored)
    const types = await client.query(
      'SELECT movement_type, COUNT(*) as cnt FROM freight_movements GROUP BY movement_type ORDER BY cnt DESC'
    );
    console.log('\n--- movement_type values in DB ---');
    types.rows.forEach(r => console.log(`  "${r.movement_type}": ${r.cnt} rows`));

    // 3. created_date column type and sample values
    const colType = await client.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'freight_movements' AND column_name = 'created_date'
    `);
    console.log('\n--- created_date column type ---');
    console.log(JSON.stringify(colType.rows[0], null, 2));

    // 4. Sample created_date raw values
    const cdSample = await client.query(
      'SELECT id, created_date, movement_type FROM freight_movements ORDER BY id LIMIT 5'
    );
    console.log('\n--- Sample rows (created_date raw) ---');
    cdSample.rows.forEach(r => console.log(`  id=${r.id} | movement_type="${r.movement_type}" | created_date="${r.created_date}"`));

    // 5. Test the EXACT query the dashboard runs (preset=30)
    const today = new Date();
    const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const fromDate = toIso(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
    const toDate = toIso(today);

    console.log(`\n--- Testing dashboard query ---`);
    console.log(`FROM: ${fromDate}  TO: ${toDate}`);

    const dashQ = await client.query(
      `SELECT COUNT(*) FROM freight_movements WHERE (created_date::date BETWEEN $1 AND $2)`,
      [fromDate, toDate]
    );
    console.log(`Rows matching created_date::date BETWEEN: ${dashQ.rows[0].count}`);

    // 6. Test without date cast (if column is TEXT)
    try {
      const dashQ2 = await client.query(
        `SELECT COUNT(*) FROM freight_movements WHERE (created_date >= $1 AND created_date <= $2)`,
        [fromDate, toDate + 'T23:59:59.999Z']
      );
      console.log(`Rows matching created_date >= / <= (text compare): ${dashQ2.rows[0].count}`);
    } catch(e) {
      console.log('Text compare failed:', e.message);
    }

    // 7. Min/Max created_date
    const minmax = await client.query('SELECT MIN(created_date), MAX(created_date) FROM freight_movements');
    console.log(`\n--- created_date range in DB ---`);
    console.log(`  MIN: ${minmax.rows[0].min}`);
    console.log(`  MAX: ${minmax.rows[0].max}`);

    // 8. arrival_date sample
    const arr = await client.query('SELECT MIN(arrival_date), MAX(arrival_date) FROM freight_movements');
    console.log(`\n--- arrival_date range in DB ---`);
    console.log(`  MIN: ${arr.rows[0].min}`);
    console.log(`  MAX: ${arr.rows[0].max}`);

  } catch(e) {
    console.error('DB ERROR:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

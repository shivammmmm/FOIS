import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://fois_user:fois_password@localhost:5432/fois_db'
});

const client = await pool.connect();

console.log('=== DIRECT DB AUDIT ===\n');

// 1. Total rows
const total = await client.query('SELECT COUNT(*) FROM freight_movements');
console.log('Total rows in freight_movements:', total.rows[0].count);

// 2. movement_type exact values
const types = await client.query('SELECT movement_type, COUNT(*) as cnt FROM freight_movements GROUP BY movement_type ORDER BY cnt DESC');
console.log('\n--- movement_type values in DB ---');
types.rows.forEach(r => console.log(`  "${r.movement_type}": ${r.cnt} rows`));

// 3. created_date column type
const colType = await client.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name='freight_movements' AND column_name='created_date'`);
console.log('\n--- created_date column type ---');
console.log(' ', JSON.stringify(colType.rows[0]));

// 4. Sample raw rows
const sample = await client.query('SELECT id, created_date, movement_type, arrival_date FROM freight_movements ORDER BY id LIMIT 5');
console.log('\n--- Sample rows ---');
sample.rows.forEach(r => console.log(`  id=${r.id} | mv="${r.movement_type}" | created="${r.created_date}" | arrival="${r.arrival_date}"`));

// 5. Test dashboard query (last 30 days by created_date)
const now = new Date();
const pad = n => String(n).padStart(2,'0');
const toIso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromDate = toIso(new Date(now.getTime() - 30*24*60*60*1000));
const toDate = toIso(now);
console.log(`\n--- Dashboard query test (${fromDate} to ${toDate}) ---`);
try {
  const r = await client.query('SELECT COUNT(*) FROM freight_movements WHERE (created_date::date BETWEEN $1 AND $2)', [fromDate, toDate]);
  console.log('  created_date::date BETWEEN result:', r.rows[0].count, 'rows');
} catch(e) { console.log('  created_date::date CAST ERROR:', e.message); }

// 6. Min/Max dates
const mm = await client.query('SELECT MIN(created_date) as mn, MAX(created_date) as mx FROM freight_movements');
console.log('\n--- created_date range ---');
console.log('  MIN:', mm.rows[0].mn, '  MAX:', mm.rows[0].mx);

const am = await client.query('SELECT MIN(arrival_date) as mn, MAX(arrival_date) as mx FROM freight_movements');
console.log('--- arrival_date range ---');
console.log('  MIN:', am.rows[0].mn, '  MAX:', am.rows[0].mx);

client.release();
await pool.end();
console.log('\nDONE');

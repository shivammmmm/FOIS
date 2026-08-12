import { pool } from "../server/db/pool.js";

async function checkColumns() {
  console.log("================================================================================");
  console.log("CHECKING FREIGHT_MOVEMENTS TABLE COLUMNS IN POSTGRESQL");
  console.log("================================================================================\n");

  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'freight_movements'
    ORDER BY ordinal_position
  `);

  console.log("freight_movements columns:");
  res.rows.forEach((r) => console.log(`  - ${r.column_name} (${r.data_type})`));

  process.exit(0);
}

checkColumns().catch(console.error);

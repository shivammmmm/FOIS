import { pool } from "../server/db/pool.js";
import { getDemandUnits, getSuppliedUnits } from "../src/utils/foisLifecycle.js";

async function findExactPbsbMivbRow() {
  console.log("================================================================================");
  console.log("FINDING EXACT PBSB -> MIVB DEMAND 6 RECORD IN DATABASE");
  console.log("================================================================================\n");

  const res = await pool.query(`
    SELECT id, business_key, active_status, data
    FROM freight_movements
    WHERE (station_from = 'PBSB' OR data->>'station_from' = 'PBSB')
      AND (station_to = 'MIVB' OR data->>'station_to' = 'MIVB')
      AND (data->>'odr_number' = '6' OR business_key LIKE '%|6|%')
  `);

  console.log(`Found ${res.rows.length} records matching PBSB -> MIVB Demand 6.\n`);

  res.rows.forEach((r, idx) => {
    const d = r.data || {};
    console.log(`Record #${idx + 1}:`);
    console.log(`  ID: ${r.id} | Status: ${r.active_status}`);
    console.log(`  Business Key: ${r.business_key}`);
    console.log(`  data.indented_units: ${d.indented_units} | data.supplied_units: ${d.supplied_units}`);
    console.log(`  getDemandUnits: ${getDemandUnits(d)} | getSuppliedUnits: ${getSuppliedUnits(d)}`);
    console.log(`  line_items:`, JSON.stringify(d.line_items, null, 2));
    console.log(`  raw_data:`, JSON.stringify(d.raw_data, null, 2));
    console.log(`--------------------------------------------------------------------------------`);
  });

  process.exit(0);
}

findExactPbsbMivbRow().catch(console.error);

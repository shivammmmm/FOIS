import { pool } from "../server/db/pool.js";
import { getDemandUnits, getSuppliedUnits } from "../src/utils/foisLifecycle.js";

async function traceInwardApi() {
  console.log("================================================================================");
  console.log("TRACING INWARD MONITOR API QUERY FOR MIVB / PBSB / RAKE 6");
  console.log("================================================================================\n");

  const query = `
    SELECT id, business_key, active_status, data
    FROM freight_movements
    WHERE active_status = 'ACTIVE'
      AND data->>'movement_type' = 'Inward'
      AND (
        data->>'station_to' = 'MIVB' OR 
        data->>'station_from' = 'PBSB' OR 
        (data->>'odr_number') = '6'
      )
  `;

  const res = await pool.query(query);
  console.log(`Found ${res.rows.length} active Inward records.\n`);

  for (const r of res.rows) {
    const d = r.data || {};
    const demand = getDemandUnits(d);
    const supply = getSuppliedUnits(d);

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`DB ID: ${r.id} | Business Key: ${r.business_key}`);
    console.log(`station_from: ${d.station_from} | station_to: ${d.station_to} | odr_number: ${d.odr_number}`);
    console.log(`d.indented_units: ${d.indented_units} | d.supplied_units: ${d.supplied_units}`);
    console.log(`getDemandUnits: ${demand} | getSuppliedUnits: ${supply}`);
    console.log(`line_items:`, JSON.stringify(d.line_items, null, 2));
  }

  process.exit(0);
}

traceInwardApi().catch(console.error);

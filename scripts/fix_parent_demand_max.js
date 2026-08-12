import { pool } from "../server/db/pool.js";

function generateBusinessKey(data = {}) {
  const zone = String(data.zone || data.raw_data?.ZONE || "").trim().toUpperCase();
  const dvsn = String(data.division || data.raw_data?.DVSN || "").trim().toUpperCase();
  const sttnFrom = String(data.station_from || data.raw_data?.["STTN FROM"] || "").trim().toUpperCase();
  const demandNo = String(data.odr_number || data.indent_number || data.raw_data?.["NO."] || data.raw_data?.["DEMAND NO."] || "").trim().toUpperCase();
  const demandDate = String(data.departure_date || data.indent_date || data.raw_data?.DATE || data.raw_data?.["DEMAND DATE"] || "").trim();
  const demandTime = String(data.indent_time || data.raw_data?.TIME || data.raw_data?.["DEMAND TIME"] || "").trim();

  return `${zone}|${dvsn}|${sttnFrom}|${demandNo}|${demandDate}|${demandTime}`;
}

async function fixParentDemandMax() {
  console.log("================================================================================");
  console.log("FIXING PARENT DEMAND UNITS TO FULL RAKE DEMAND ACROSS ALL ACTIVE RECORDS");
  console.log("================================================================================\n");

  const res = await pool.query(
    "SELECT id, business_key, active_status, data FROM freight_movements WHERE active_status = 'ACTIVE'"
  );

  console.log(`Auditing ${res.rows.length} active records...\n`);

  let fixedCount = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const r of res.rows) {
      const data = r.data || {};
      const lineItems = data.line_items || [];
      const currentDemand = Number(data.indented_units) || 0;

      // Extract all demand numbers across root and line items
      const rawIndented = Number(data.raw_data?.["INDENTED UNTS"] || data.raw_data?.indented_units || 0);
      const lineDemands = lineItems.map((item) => {
        return Number(item.indented_units || item.raw_data?.["INDENTED UNTS"] || item.raw_data?.indented_units || 0);
      });

      const maxDemand = Math.max(currentDemand, rawIndented, ...lineDemands);

      // If line items sum equals maxDemand (e.g. 5+43+11 = 59), or if maxDemand > currentDemand (e.g. 59 > 11)
      if (maxDemand > currentDemand) {
        console.log(`Fixing Record ID: ${r.id} | Key: ${r.business_key}`);
        console.log(`  Old Demand: ${currentDemand} -> New Parent Demand: ${maxDemand}`);

        const updatedData = {
          ...data,
          indented_units: maxDemand,
          wagons: maxDemand,
          updated_at: new Date().toISOString()
        };

        await client.query(
          "UPDATE freight_movements SET data = $1, updated_date = NOW() WHERE id = $2",
          [updatedData, r.id]
        );

        fixedCount++;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully fixed parent demand units on ${fixedCount} records!`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Fix transaction failed:", err);
  } finally {
    client.release();
  }

  process.exit(0);
}

fixParentDemandMax().catch(console.error);

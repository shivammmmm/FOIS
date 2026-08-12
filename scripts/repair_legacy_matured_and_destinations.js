/**
 * One-time repair for data corrupted by scripts/execute_legacy_sync.js:
 *
 * 1. "Matured" status was set using a matured_date/maturity_date fallback that could
 *    actually be an EXPECTED LOADING DATE, not a real "MET WITH DATE" from the Matured
 *    Indent sheet. This re-derives matured status from genuine matured_indents data only,
 *    and reverts records that were falsely marked Matured back to Indent/Supplied.
 * 2. station_to (DSTN) was rebuilt via a Set that failed to dedupe old inconsistent values,
 *    producing garbled repeated destination lists (e.g. "SAIL, SAIL, SAIL"). This cleans
 *    every station_to by splitting on comma, trimming, and re-deduping.
 *
 * Usage:
 *   node scripts/repair_legacy_matured_and_destinations.js           (dry run, no writes)
 *   node scripts/repair_legacy_matured_and_destinations.js --apply   (writes changes)
 */
import { pool } from "../server/db/pool.js";

const APPLY = process.argv.includes("--apply");

function cleanStationTo(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const deduped = Array.from(new Set(parts));
  return deduped.join(", ");
}

function genuineMetWithDate(data) {
  const raw = data?.raw_data || {};
  const value = data?.met_with_date || raw["MET WITH DATE"] || raw["METWITH DATE"] || raw["met_with_date"] || "";
  const str = String(value || "").trim();
  return str && str !== "-" ? str : "";
}

async function main() {
  console.log("==================================================");
  console.log(`LEGACY MATURED-DATE / DESTINATION REPAIR ${APPLY ? "(APPLY)" : "(DRY RUN)"}`);
  console.log("==================================================\n");

  const client = await pool.connect();
  try {
    const [fmQuery, miQuery] = await Promise.all([
      client.query(
        `SELECT id, data, business_key FROM freight_movements WHERE active_status = 'ACTIVE'`
      ),
      client.query(`SELECT id, data, business_key FROM matured_indents`),
    ]);

    // Build business_key -> genuine MET WITH DATE map from matured_indents (source of truth).
    const genuineMetMap = new Map();
    for (const row of miQuery.rows) {
      const data = typeof row.data === "object" && row.data ? row.data : {};
      const key = row.business_key || data.business_key;
      if (!key) continue;
      const met = genuineMetWithDate(data);
      if (met && !genuineMetMap.has(key)) genuineMetMap.set(key, met);
    }

    let destinationFixed = 0;
    let maturedConfirmedCleaned = 0;
    let maturedReverted = 0;
    let revertedToSupplied = 0;
    let revertedToIndent = 0;
    const updates = [];

    for (const row of fmQuery.rows) {
      const data = typeof row.data === "object" && row.data ? row.data : {};
      const key = row.business_key || data.business_key;
      let changed = false;
      const nextData = { ...data };

      // 1. Clean destination
      const cleanedDstn = cleanStationTo(data.station_to);
      if (cleanedDstn !== (data.station_to || "")) {
        nextData.station_to = cleanedDstn;
        changed = true;
        destinationFixed++;
      }

      // 2. Re-verify matured status against genuine matured_indents data
      if (data.status === "Matured") {
        const genuineMet = key ? genuineMetMap.get(key) || "" : "";

        if (genuineMet) {
          // Real maturity confirmed — make sure stored dates/raw_data match the genuine value.
          if (data.matured_date !== genuineMet || data.met_with_date !== genuineMet || data.raw_data?.["MET WITH DATE"] !== genuineMet) {
            nextData.matured_date = genuineMet;
            nextData.met_with_date = genuineMet;
            nextData.raw_data = { ...data.raw_data, "MET WITH DATE": genuineMet };
            changed = true;
          }
          maturedConfirmedCleaned++;
        } else {
          // No genuine MET WITH DATE anywhere — this was falsely matured by the legacy fallback bug.
          const suppliedUnits = Number(data.supplied_units || 0);
          const suppliedTime = String(data.supplied_time || "").trim();
          const hasSupply = suppliedUnits > 0 || Boolean(suppliedTime);
          nextData.status = hasSupply ? "Supplied" : "Indent";
          nextData.matured_date = "";
          nextData.met_with_date = "";
          nextData.raw_data = { ...data.raw_data, "MET WITH DATE": "" };
          nextData.odr_matched = false;
          changed = true;
          maturedReverted++;
          if (hasSupply) revertedToSupplied++;
          else revertedToIndent++;
        }
      }

      if (changed) {
        nextData.updated_at = new Date().toISOString();
        updates.push({ id: String(row.id), data: nextData });
      }
    }

    console.log(`Active freight_movements scanned: ${fmQuery.rows.length}`);
    console.log(`matured_indents scanned (genuine MET WITH DATE source): ${miQuery.rows.length}\n`);
    console.log(`Destination (station_to) values cleaned: ${destinationFixed}`);
    console.log(`"Matured" records confirmed genuine (dates/raw_data normalized): ${maturedConfirmedCleaned}`);
    console.log(`"Matured" records reverted (no real MET WITH DATE found): ${maturedReverted}`);
    console.log(`  -> reverted to "Supplied": ${revertedToSupplied}`);
    console.log(`  -> reverted to "Indent":   ${revertedToIndent}`);
    console.log(`\nTotal rows to update: ${updates.length}`);

    if (!APPLY) {
      console.log("\n[Dry Run] No database modifications performed. Re-run with --apply to write changes.");
      return;
    }

    await client.query("BEGIN");
    const chunkSize = 500;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 2;
        values.push(item.id, item.data);
        return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
      });
      await client.query(
        `UPDATE freight_movements SET data = v.data, updated_date = NOW()
         FROM (VALUES ${placeholders.join(",")}) AS v(id, data)
         WHERE freight_movements.id = v.id`,
        values
      );
    }
    await client.query("COMMIT");
    console.log("\n✅ REPAIR TRANSACTION COMMITTED SUCCESSFULLY.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("❌ REPAIR FAILED:", err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

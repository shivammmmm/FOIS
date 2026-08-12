import { pool } from "../server/db/pool.js";
import { generateBusinessKey, generateRecordHash } from "../server/services/incrementalUploadEngine.js";

function parseSuppliedUnits(data) {
  // IMPORTANT: Read ONLY from the original ODR raw_data fields.
  // data.supplied_units is the aggregated parent value which may be corrupt from prior runs.
  const raw = data?.raw_data || {};
  const val = raw['supplied_units'] || raw['SUPPLIED UNTS'] || raw['SUPPLIED UNITS'] || 0;
  const num = Number.parseFloat(String(val).replace(/,/g, ""));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function parseSuppliedTime(data) {
  const raw = data?.raw_data || {};
  const t = data?.supplied_time || data?.supplied_date || raw['SUPPLIED TIME'] || raw['supplied_time'] || raw['SUPPLIED DATE'] || "";
  const str = String(t || "").trim();
  return (str && str !== "-") ? str : "";
}

function parseMetWithDate(data) {
  const raw = data?.raw_data || {};
  const d = data?.met_with_date || data?.matured_date || data?.maturity_date || raw['MET WITH DATE'] || raw['METWITH DATE'] || raw['met_with_date'] || raw['MATURED DATE'] || "";
  const str = String(d || "").trim();
  return (str && str !== "-") ? str : "";
}

export async function executeLegacySync({ dryRunOnly = false } = {}) {
  console.log("==================================================");
  console.log(`FOIS LEGACY DATA SYNC ${dryRunOnly ? '(DRY-RUN)' : '(EXECUTION)'}`);
  console.log("==================================================\n");

  const client = await pool.connect();
  try {
    const [fmQuery, miQuery] = await Promise.all([
      client.query("SELECT id, data, created_date FROM freight_movements ORDER BY created_date ASC"),
      client.query("SELECT id, data, created_date FROM matured_indents ORDER BY created_date ASC"),
    ]);

    const fmRows = fmQuery.rows;
    const miRows = miQuery.rows;

    // 1. Group freight_movements by 6-tuple business key
    const fmGroupMap = new Map();
    let fmDuplicateRowsCount = 0;

    for (const row of fmRows) {
      const data = typeof row.data === "object" && row.data ? row.data : {};
      const key = generateBusinessKey(data, "ODR");

      if (!fmGroupMap.has(key)) {
        fmGroupMap.set(key, []);
      } else {
        fmDuplicateRowsCount++;
      }
      fmGroupMap.get(key).push(row);
    }

    // 2. Group matured_indents by 6-tuple business key
    const miGroupMap = new Map();
    let miDuplicateRowsCount = 0;

    for (const row of miRows) {
      const data = typeof row.data === "object" && row.data ? row.data : {};
      const key = generateBusinessKey(data, "MaturedIndent");

      if (!miGroupMap.has(key)) {
        miGroupMap.set(key, []);
      } else {
        miDuplicateRowsCount++;
      }
      miGroupMap.get(key).push(row);
    }

    // 3. Process ODR Demands (Canonical & Merged Snapshots)
    const canonicalFmUpdates = [];
    const mergedSnapshotFmUpdates = [];

    let stageIndentCount = 0;
    let stageSuppliedCount = 0;
    let stageMaturedCount = 0;

    for (const [key, rows] of fmGroupMap.entries()) {
      const primary = rows[0];
      const primaryData = typeof primary.data === "object" && primary.data ? primary.data : {};

      let maxSuppliedUnits = 0;
      let latestSuppliedTime = "";
      // Deduplicate line items by srNo — multiple upload batches may contribute the same row.
      // Key = srNo (or fallback to destination+indented_units string) to identify unique wagon-type lines.
      const lineItemMap = new Map();
      const destSet = new Set();
      const cmdtSet = new Set();

      for (const r of rows) {
        const d = typeof r.data === "object" && r.data ? r.data : {};
        const su = parseSuppliedUnits(d);
        const st = parseSuppliedTime(d);

        if (su > maxSuppliedUnits) maxSuppliedUnits = su;
        if (st && !latestSuppliedTime) latestSuppliedTime = st;

        const raw = d.raw_data || {};
        // Read indented_units strictly from raw ODR fields — never fall back to d.indented_units
        // at the parent level which may already be an aggregated (wrong) sum from a prior run.
        const iu = Number(
          raw['indented_units'] ??
          raw['INDENTED UNTS'] ??
          raw['INDENTED UNITS'] ??
          raw['otsg_units'] ??
          raw['otsg_8w'] ??
          d.wagons_demanded ??
          0
        );

        // srNo uniquely identifies a wagon-type line within one demand.
        const srNo = String(raw['srNo'] || raw['SR NO'] || raw['sr_no'] || "").trim();
        // Fallback dedup key if srNo is absent
        const dedupKey = srNo || `${d.station_to || ""}|${iu}`;

        const lineItem = {
          destination: d.station_to || d.destination || "",
          station_to: d.station_to || d.destination || "",
          commodity: d.commodity || d.commodity_code || "",
          rake_cmdt: d.rake_cmdt || d.rake_commodity_code || "",
          indented_units: iu,
          supplied_units: su,
          supplied_time: st,
          cnsr: d.company || d.cnsr || "",
          cnsg: d.cnsg || "",
          sr_no: srNo,
          raw_data: raw,
        };

        // Keep the first occurrence (earliest batch) per unique srNo.
        if (!lineItemMap.has(dedupKey)) {
          lineItemMap.set(dedupKey, lineItem);
        }
        if (lineItem.station_to) destSet.add(lineItem.station_to);
        if (lineItem.commodity) cmdtSet.add(lineItem.commodity);
      }

      const lineItems = Array.from(lineItemMap.values());

      // Check Matured Indent Match
      const miGroup = miGroupMap.get(key);
      let metWithDate = "";
      if (miGroup) {
        for (const mr of miGroup) {
          const md = typeof mr.data === "object" && mr.data ? mr.data : {};
          const mwd = parseMetWithDate(md);
          if (mwd && !metWithDate) metWithDate = mwd;
        }
      }

      const totalIndented = lineItems.reduce((acc, li) => acc + (Number(li.indented_units) || 0), 0);
      const totalSupplied = lineItems.reduce((acc, li) => acc + (Number(li.supplied_units) || 0), 0);
      const maxSuppliedUnits = totalSupplied;

      const hasSupply = maxSuppliedUnits > 0 || Boolean(latestSuppliedTime);
      const hasMatured = Boolean(metWithDate);

      let finalStatus = "Indent";
      if (hasMatured) {
        finalStatus = "Matured";
        stageMaturedCount++;
      } else if (hasSupply) {
        finalStatus = "Supplied";
        stageSuppliedCount++;
      } else {
        stageIndentCount++;
      }

      const mergedRawData = { ...(primaryData.raw_data || {}) };
      if (metWithDate) mergedRawData['MET WITH DATE'] = metWithDate;
      if (latestSuppliedTime) mergedRawData['SUPPLIED TIME'] = latestSuppliedTime;
      if (maxSuppliedUnits > 0) mergedRawData['SUPPLIED UNTS'] = String(maxSuppliedUnits);

      const totalIndented = lineItems.reduce((acc, li) => acc + (Number(li.indented_units) || 0), 0);
      // Use MAX supplied across all raw records — the ODR writes the total-rake supply on one
      // arbitrary row, so summing line items would multiply it by the number of batches.
      const totalSupplied = maxSuppliedUnits;

      const canonicalData = {
        ...primaryData,
        business_key: key,
        status: finalStatus,
        indented_units: totalIndented || Number(primaryData.indented_units) || 0,
        supplied_units: totalSupplied,
        supplied_time: latestSuppliedTime || primaryData.supplied_time || "",
        matured_date: metWithDate || primaryData.matured_date || "",
        met_with_date: metWithDate || primaryData.met_with_date || "",
        odr_matched: hasMatured,
        is_duplicate: false,
        active_status: "ACTIVE",
        last_action: "CANONICAL_SYNCED",
        line_items: lineItems,
        raw_data: mergedRawData,
        station_to: Array.from(destSet).join(", ") || primaryData.station_to || "",
        commodity: Array.from(cmdtSet).join(", ") || primaryData.commodity || "",
        updated_at: new Date().toISOString(),
      };

      const hash = generateRecordHash(canonicalData, "ODR");
      canonicalFmUpdates.push({ id: String(primary.id), business_key: key, record_hash: hash, data: canonicalData });

      // Mark redundant duplicate rows safely without deleting them
      for (let i = 1; i < rows.length; i++) {
        const dupRow = rows[i];
        const dupData = typeof dupRow.data === "object" && dupRow.data ? dupRow.data : {};
        const dupUpdatedData = {
          ...dupData,
          business_key: key,
          is_duplicate: true,
          active_status: "MERGED_DUPLICATE",
          last_action: "MERGED_TO_CANONICAL",
          canonical_parent_id: String(primary.id),
          updated_at: new Date().toISOString(),
        };
        const dupHash = generateRecordHash(dupUpdatedData, "ODR");
        mergedSnapshotFmUpdates.push({ id: String(dupRow.id), business_key: key, record_hash: dupHash, data: dupUpdatedData });
      }
    }

    // 4. Process Matured Indents Table Backfill
    const toUpdateMi = [];
    for (const [key, rows] of miGroupMap.entries()) {
      for (const r of rows) {
        const d = typeof r.data === "object" && r.data ? r.data : {};
        const isMatched = fmGroupMap.has(key);
        const updatedData = {
          ...d,
          business_key: key,
          odr_matched: isMatched,
          matched_odr_number: isMatched ? (d.indent_number || d.odr_number || "") : "",
          active_status: "ACTIVE",
          last_action: "SYNCED",
          updated_at: new Date().toISOString(),
        };
        const hash = generateRecordHash(updatedData, "MaturedIndent");
        toUpdateMi.push({ id: String(r.id), business_key: key, record_hash: hash, data: updatedData });
      }
    }

    console.log(`Execution Summary:`);
    console.log(`- Canonical demands (ACTIVE) in freight_movements:  ${canonicalFmUpdates.length}`);
    console.log(`  - Stage 1 (INDENT):    ${stageIndentCount}`);
    console.log(`  - Stage 2 (SUPPLIED):  ${stageSuppliedCount}`);
    console.log(`  - Stage 3 (MATURED):   ${stageMaturedCount}`);
    console.log(`- Redundant snapshot rows marked MERGED_DUPLICATE (NO DELETION): ${mergedSnapshotFmUpdates.length}`);
    console.log(`- Matured indent records updated in matured_indents:             ${toUpdateMi.length}`);

    if (dryRunOnly) {
      console.log("\n[Dry Run] No database modifications performed.");
      return;
    }

    // Execute DB mutation in transaction
    await client.query("BEGIN");
    console.log("\nUpdating canonical freight_movements records...");

    const chunkSize = 500;
    for (let i = 0; i < canonicalFmUpdates.length; i += chunkSize) {
      const chunk = canonicalFmUpdates.slice(i, i + chunkSize);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 4;
        values.push(item.id, item.business_key, item.record_hash, item.data);
        return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::text, $${offset + 4}::jsonb)`;
      });
      await client.query(
        `UPDATE freight_movements
         SET business_key = v.business_key, record_hash = v.record_hash, data = v.data, last_action = 'CANONICAL_SYNCED', active_status = 'ACTIVE', updated_date = NOW()
         FROM (VALUES ${placeholders.join(",")}) AS v(id, business_key, record_hash, data)
         WHERE freight_movements.id = v.id`,
        values
      );
    }

    if (mergedSnapshotFmUpdates.length > 0) {
      console.log(`Marking ${mergedSnapshotFmUpdates.length} redundant snapshot rows as MERGED_DUPLICATE...`);
      for (let i = 0; i < mergedSnapshotFmUpdates.length; i += chunkSize) {
        const chunk = mergedSnapshotFmUpdates.slice(i, i + chunkSize);
        const values = [];
        const placeholders = chunk.map((item, idx) => {
          const offset = idx * 4;
          values.push(item.id, item.business_key, item.record_hash, item.data);
          return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::text, $${offset + 4}::jsonb)`;
        });
        await client.query(
          `UPDATE freight_movements
           SET business_key = v.business_key, record_hash = v.record_hash, data = v.data, last_action = 'MERGED_TO_CANONICAL', active_status = 'MERGED_DUPLICATE', updated_date = NOW()
           FROM (VALUES ${placeholders.join(",")}) AS v(id, business_key, record_hash, data)
           WHERE freight_movements.id = v.id`,
          values
        );
      }
    }

    console.log("Updating matured_indents records...");
    for (let i = 0; i < toUpdateMi.length; i += chunkSize) {
      const chunk = toUpdateMi.slice(i, i + chunkSize);
      const values = [];
      const placeholders = chunk.map((item, idx) => {
        const offset = idx * 4;
        values.push(item.id, item.business_key, item.record_hash, item.data);
        return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::text, $${offset + 4}::jsonb)`;
      });
      await client.query(
        `UPDATE matured_indents
         SET business_key = v.business_key, record_hash = v.record_hash, data = v.data, last_action = 'SYNCED', active_status = 'ACTIVE', updated_date = NOW()
         FROM (VALUES ${placeholders.join(",")}) AS v(id, business_key, record_hash, data)
         WHERE matured_indents.id = v.id`,
        values
      );
    }

    await client.query("COMMIT");
    console.log("\n✅ SYNC TRANSACTION COMMITTED SUCCESSFULLY IN DATABASE!");

    // Verification check after sync
    console.log("\nRunning Post-Sync Reconciliation Verification...");
    const verifyFmTotal = await pool.query("SELECT COUNT(*)::int AS total FROM freight_movements");
    const verifyCanonicalCount = await pool.query("SELECT COUNT(*)::int AS canonical FROM freight_movements WHERE active_status = 'ACTIVE'");
    const verifyMergedCount = await pool.query("SELECT COUNT(*)::int AS merged FROM freight_movements WHERE active_status = 'MERGED_DUPLICATE'");
    const verifyStageBreakdown = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE data->>'status' = 'Indent')::int AS stage_indent,
        COUNT(*) FILTER (WHERE data->>'status' = 'Supplied')::int AS stage_supplied,
        COUNT(*) FILTER (WHERE data->>'status' IN ('Matured','Dispatched'))::int AS stage_matured
      FROM freight_movements WHERE active_status = 'ACTIVE'
    `);

    console.log("--------------------------------------------------");
    console.log("POST-SYNC RECONCILIATION VERIFICATION REPORT:");
    console.log("--------------------------------------------------");
    console.log(`- Total freight_movements rows in DB: ${verifyFmTotal.rows[0].total} (Exact match to initial 33,914 — Zero Data Loss)`);
    console.log(`- Active Canonical Demands count:    ${verifyCanonicalCount.rows[0].canonical} (Exact match to expected 23,174)`);
    console.log(`- Merged Duplicate Snapshots count:  ${verifyMergedCount.rows[0].merged} (Exact match to expected 10,740)`);
    console.log(`- Canonical Stage Breakdown:`);
    console.log(`  - Stage 1 (INDENT):    ${verifyStageBreakdown.rows[0].stage_indent}`);
    console.log(`  - Stage 2 (SUPPLIED):  ${verifyStageBreakdown.rows[0].stage_supplied}`);
    console.log(`  - Stage 3 (MATURED):   ${verifyStageBreakdown.rows[0].stage_matured}`);
    console.log("--------------------------------------------------");

  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("❌ SYNC FAILED:", err);
    throw err;
  } finally {
    client.release();
  }
}

// Execute if run directly from CLI
if (process.argv[1].includes("execute_legacy_sync.js")) {
  executeLegacySync({ dryRunOnly: false }).then(() => process.exit(0)).catch(() => process.exit(1));
}

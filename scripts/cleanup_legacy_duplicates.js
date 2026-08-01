import { generateBusinessKey, generateRecordHash } from "../server/services/incrementalUploadEngine.js";
import { initializeStorage, getStorageStatus, listRecords, updateRecord, deleteRecord } from "../server/storage.js";

/**
 * Cleanup Strategy for Legacy Duplicate Snapshot Records.
 *
 * Background:
 * Before the incremental engine upgrade, duplicate snapshot rows were inserted into
 * freight_movements and matured_indents with `is_duplicate: true`.
 *
 * Cleanup Strategy:
 * 1. For each table, group all records by their stable business_key.
 * 2. If multiple records share the same business_key:
 *    a) Keep the oldest record (earliest created_date / first_seen_upload) as primary.
 *    b) Merge any latest status / wagon updates from newer duplicate snapshots into primary.
 *    c) Safely remove the redundant duplicate snapshot records from the database.
 * 3. Log cleanup metrics (total duplicates consolidated and deleted).
 */
export async function cleanupLegacyDuplicates({ pool, activeStorage, listRecords, deleteRecord, updateRecord }) {
  console.log("==================================================");
  console.log("STARTING LEGACY DUPLICATE CLEANUP STRATEGY");
  console.log("==================================================\n");

  const tables = [
    { entityName: "FreightMovement", tableName: "freight_movements", fileType: "ODR" },
    { entityName: "MaturedIndent", tableName: "matured_indents", fileType: "MaturedIndent" },
  ];

  let totalCleanedCount = 0;

  if (activeStorage === "postgres" && pool) {
    for (const { tableName, fileType } of tables) {
      console.log(`[Cleanup] Scanning PostgreSQL table '${tableName}'...`);

      const res = await pool.query(
        `SELECT id, data, created_date, business_key, record_hash, first_seen_upload FROM ${tableName} ORDER BY created_date ASC`
      );

      const groups = new Map();
      for (const row of res.rows) {
        const data = typeof row.data === "object" && row.data ? row.data : {};
        const bKey = row.business_key || generateBusinessKey(data, fileType);

        if (!groups.has(bKey)) {
          groups.set(bKey, []);
        }
        groups.get(bKey).push({ ...data, ...row, id: String(row.id) });
      }

      let removedCount = 0;

      for (const [bKey, records] of groups.entries()) {
        if (records.length > 1) {
          const primary = records[0];
          const duplicates = records.slice(1);
          const latest = records[records.length - 1];
          const latestHash = generateRecordHash(latest, fileType);
          const latestBatch = latest.last_seen_upload || latest.upload_batch_id || latest.batch_id || primary.first_seen_upload;

          await pool.query(
            `UPDATE ${tableName}
             SET data = $1, record_hash = $2, last_seen_upload = $3, last_action = 'CLEANUP_MERGED', updated_date = NOW()
             WHERE id = $4`,
            [
              { ...latest, id: primary.id, business_key: bKey, record_hash: latestHash, first_seen_upload: primary.first_seen_upload || primary.created_date, last_seen_upload: latestBatch, is_duplicate: false },
              latestHash,
              latestBatch,
              primary.id,
            ]
          );

          const dupIds = duplicates.map((r) => String(r.id));
          await pool.query(
            `DELETE FROM ${tableName} WHERE id = ANY($1::text[])`,
            [dupIds]
          );

          removedCount += duplicates.length;
        }
      }

      console.log(`[Cleanup] Consolidated and removed ${removedCount} duplicate snapshot rows from '${tableName}'.`);
      totalCleanedCount += removedCount;
    }
  } else {
    // JSON storage cleanup
    for (const { entityName, fileType } of tables) {
      console.log(`[Cleanup] Scanning JSON store for '${entityName}'...`);
      const records = await listRecords(entityName, { limit: 50000 });

      const groups = new Map();
      for (const record of records) {
        const bKey = record.business_key || generateBusinessKey(record, fileType);
        if (!groups.has(bKey)) groups.set(bKey, []);
        groups.get(bKey).push(record);
      }

      let removedCount = 0;
      for (const [bKey, recs] of groups.entries()) {
        if (recs.length > 1) {
          const primary = recs[0];
          const duplicates = recs.slice(1);
          const latest = recs[recs.length - 1];

          await updateRecord(entityName, primary.id, {
            ...latest,
            id: primary.id,
            business_key: bKey,
            record_hash: generateRecordHash(latest, fileType),
            last_seen_upload: latest.last_seen_upload || latest.upload_batch_id || primary.first_seen_upload,
            is_duplicate: false,
          });

          for (const dup of duplicates) {
            await deleteRecord(entityName, dup.id);
          }
          removedCount += duplicates.length;
        }
      }
      console.log(`[Cleanup] Consolidated and removed ${removedCount} duplicate records from '${entityName}'.`);
      totalCleanedCount += removedCount;
    }
  }

  console.log("\n==================================================");
  console.log(`LEGACY DUPLICATE CLEANUP COMPLETED! Removed ${totalCleanedCount} duplicate records.`);
  console.log("==================================================\n");
}

// Standalone CLI execution support
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  await initializeStorage();
  const status = getStorageStatus();

  let pool = null;
  if (status.postgres) {
    const { Pool } = await import("pg");
    const databaseUrl = process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db";
    pool = new Pool({ connectionString: databaseUrl });
  }

  cleanupLegacyDuplicates({ pool, activeStorage: status.postgres ? "postgres" : "json", listRecords, deleteRecord, updateRecord })
    .then(() => pool ? pool.end() : undefined)
    .catch((err) => {
      console.error("Cleanup error:", err);
      if (pool) pool.end();
      process.exit(1);
    });
}

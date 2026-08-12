import { generateBusinessKey, generateRecordHash } from "./incrementalUploadEngine.js";

/**
 * Idempotent migration to backfill business_key, record_hash, first_seen_upload,
 * last_seen_upload, last_action, and active_status for existing database records.
 */
export async function runIncrementalUploadMigration(pool, activeStorage, listRecords, updateRecord) {
  console.info("[Migration] Checking incremental engine migration status...");

  const entities = [
    { entityName: "FreightMovement", tableName: "freight_movements", fileType: "ODR" },
    { entityName: "MaturedIndent", tableName: "matured_indents", fileType: "MaturedIndent" },
  ];

  if (activeStorage === "postgres" && pool) {
    for (const { tableName, fileType } of entities) {
      try {
        // Ensure columns exist
        for (const col of ["business_key", "record_hash", "first_seen_upload", "last_seen_upload", "last_action", "active_status"]) {
          await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${col} TEXT`);
        }
        await pool.query(`CREATE INDEX IF NOT EXISTS ${tableName}_business_key_idx ON ${tableName} (business_key)`);

        let totalBackfilled = 0;

        while (true) {
          // Fetch unmigrated records
          const unmigrated = await pool.query(
            `SELECT id, data FROM ${tableName} WHERE business_key IS NULL OR (data->>'business_key') IS NULL LIMIT 2000`
          );

          if (unmigrated.rows.length === 0) break;

          console.info(`[Migration] Backfilling batch of ${unmigrated.rows.length} records in ${tableName}...`);
          for (const row of unmigrated.rows) {
            const data = typeof row.data === "object" && row.data ? row.data : {};
            const businessKey = generateBusinessKey(data, fileType);
            const recordHash = generateRecordHash(data, fileType);
            const batchId = data.upload_batch_id || data.batch_id || "LEGACY";

            const updatedData = {
              ...data,
              business_key: businessKey,
              record_hash: recordHash,
              first_seen_upload: data.first_seen_upload || batchId,
              last_seen_upload: data.last_seen_upload || batchId,
              last_action: data.last_action || "MIGRATED",
              active_status: data.active_status || "ACTIVE",
            };

            await pool.query(
              `UPDATE ${tableName}
               SET business_key = $1, record_hash = $2, first_seen_upload = $3, last_seen_upload = $4, last_action = $5, active_status = $6, data = $7
               WHERE id = $8`,
              [businessKey, recordHash, updatedData.first_seen_upload, updatedData.last_seen_upload, "MIGRATED", "ACTIVE", updatedData, String(row.id)]
            );
          }
          totalBackfilled += unmigrated.rows.length;
        }

        if (totalBackfilled > 0) {
          console.info(`[Migration] Total backfilled ${totalBackfilled} records in ${tableName}.`);
        }
      } catch (err) {
        console.error(`[Migration] Error backfilling ${tableName}:`, err?.message);
      }
    }
  } else {
    // JSON storage backfill
    for (const { entityName, fileType } of entities) {
      try {
        const records = await listRecords(entityName, { limit: 50000 });
        for (const record of records) {
          if (!record.business_key) {
            const businessKey = generateBusinessKey(record, fileType);
            const recordHash = generateRecordHash(record, fileType);
            const batchId = record.upload_batch_id || record.batch_id || "LEGACY";
            await updateRecord(entityName, record.id, {
              business_key: businessKey,
              record_hash: recordHash,
              first_seen_upload: record.first_seen_upload || batchId,
              last_seen_upload: record.last_seen_upload || batchId,
              last_action: "MIGRATED",
              active_status: "ACTIVE",
            });
          }
        }
      } catch (err) {
        console.error(`[Migration] JSON backfill error for ${entityName}:`, err?.message);
      }
    }
  }

  console.info("[Migration] Incremental engine migration check completed.");
}

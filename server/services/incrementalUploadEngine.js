import crypto from "crypto";

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Generate stable, permanent Business Key for a record.
 * Must NEVER use mutable fields (arrival/departure dates, status, wagons, upload timestamps, batchId).
 */
export function generateBusinessKey(record, fileType = "ODR") {
  const typePrefix = fileType === "MaturedIndent" ? "MATURED" : "ODR";
  const division = norm(record.division);
  const number = norm(record.odr_number || record.indent_number || record.indentNo);
  const stationFrom = norm(record.station_from || record.stationFrom);
  const stationTo = norm(record.station_to || record.destination);
  const commodity = norm(record.commodity);
  const company = norm(record.company || record.cnsr || record.company_code);

  return `${typePrefix}|${division}|${number}|${stationFrom}|${stationTo}|${commodity}|${company}`;
}

/**
 * Generate SHA-256 hash of mutable record fields.
 * If hash differs from stored record_hash, the record has been UPDATED.
 */
export function generateRecordHash(record, fileType = "ODR") {
  const isIndent = fileType === "MaturedIndent";
  const payload = isIndent
    ? {
        wagons_demanded: Number(record.wagons_demanded || record.wagons || 0),
        indent_date: norm(record.indent_date),
        maturity_date: norm(record.maturity_date || record.expectedLoadingDate),
        rake_cmdt: norm(record.rake_cmdt || record.rake_commodity_code),
        wagon_type: norm(record.wagon_type),
        product: norm(record.product || record.product_code),
      }
    : {
        status: norm(record.status),
        wagons: Number(record.wagons || record.supplied_units || 0),
        arrival_date: norm(record.arrival_date || record.expectedLoadingDate),
        departure_date: norm(record.departure_date || record.indentDate),
        rake_cmdt: norm(record.rake_cmdt || record.rake_commodity_code),
        wagon_type: norm(record.wagon_type),
        movement_type: norm(record.movement_type),
        product: norm(record.product || record.product_code),
      };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Deduplicate rows inside the same uploaded Excel file.
 * Returns { uniqueRecords, duplicateRowsCount }.
 */
export function deduplicateIntraFileRecords(parsedRecords, fileType = "ODR") {
  const seenMap = new Map();
  let duplicateRowsCount = 0;

  for (const record of Array.isArray(parsedRecords) ? parsedRecords : []) {
    const key = generateBusinessKey(record, fileType);
    if (seenMap.has(key)) {
      duplicateRowsCount++;
    }
    // Store latest occurrence
    seenMap.set(key, record);
  }

  return {
    uniqueRecords: Array.from(seenMap.values()),
    duplicateRowsCount,
  };
}

/**
 * Classify a batch of incoming parsed records against existing DB records.
 * Returns { newRecords, updatedRecords, unchangedRecords }
 */
export function classifyBatchRecords(parsedRecords, existingKeyMap, batchId, fileType = "ODR") {
  const newRecords = [];
  const updatedRecords = [];
  const unchangedRecords = [];

  for (const record of Array.isArray(parsedRecords) ? parsedRecords : []) {
    const businessKey = generateBusinessKey(record, fileType);
    const recordHash = generateRecordHash(record, fileType);

    const existing = existingKeyMap.get(businessKey);

    if (!existing) {
      // NEW RECORD
      const preparedRecord = {
        ...record,
        business_key: businessKey,
        record_hash: recordHash,
        first_seen_upload: batchId,
        last_seen_upload: batchId,
        last_action: "NEW",
        active_status: "ACTIVE",
        is_duplicate: false,
      };
      newRecords.push(preparedRecord);
    } else {
      const existingHash = existing.record_hash || existing.data?.record_hash;
      const existingFirstSeen = existing.first_seen_upload || existing.data?.first_seen_upload || existing.data?.upload_batch_id || batchId;

      if (existingHash !== recordHash) {
        // UPDATED RECORD
        const preparedRecord = {
          ...record,
          id: String(existing.id), // Preserve original ID
          business_key: businessKey,
          record_hash: recordHash,
          first_seen_upload: existingFirstSeen,
          last_seen_upload: batchId,
          last_action: "UPDATED",
          active_status: "ACTIVE",
          is_duplicate: false,
        };
        updatedRecords.push(preparedRecord);
      } else {
        // UNCHANGED RECORD (SKIP)
        const preparedRecord = {
          ...record,
          id: String(existing.id),
          business_key: businessKey,
          record_hash: recordHash,
          first_seen_upload: existingFirstSeen,
          last_seen_upload: batchId,
          last_action: "SKIPPED",
          active_status: "ACTIVE",
          is_duplicate: true,
        };
        unchangedRecords.push(preparedRecord);
      }
    }
  }

  return { newRecords, updatedRecords, unchangedRecords };
}

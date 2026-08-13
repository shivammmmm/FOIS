import crypto from "crypto";
import { formatFoisDate, formatFoisTime } from "../../src/utils/foisDateTime.js";

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

// Excel stores dates/times as raw numeric serials (e.g. 0.4451388... for
// 10:41 AM); reading a cell with raw:true hands that number straight
// through uncoverted. Convert a purely-numeric value via the given FOIS
// formatter before it goes into the key. An already-formatted string (ISO
// date, "HH:MM") is left completely untouched — changing the format of a
// key that already works would break matching for every currently in-flight
// indent on its next upload, since the stored key was built the old way.
function normalizeKeyPart(rawValue, formatter) {
  const text = String(rawValue ?? "").trim();
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return norm(text);
  const formatted = formatter(text);
  return formatted ? norm(formatted) : norm(text);
}

// Walk candidates in priority order and return the first one that is a real,
// present value — unlike `??`, an empty string or a genuine 0 does not stop
// the search, so a later (correct) field isn't skipped just because an
// earlier one happened to be blank/zero.
function firstRealNumber(candidates, { requirePositive = false } = {}) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed === "") continue;
    const num = Number(trimmed);
    if (Number.isNaN(num)) continue;
    if (requirePositive && num <= 0) continue;
    return num;
  }
  return 0;
}

/**
 * Generate stable, permanent Business Key for a record.
 * Must NEVER use mutable fields (arrival/departure dates, status, wagons, upload timestamps, batchId).
 */
export function generateBusinessKey(record, fileType = "ODR") {
  const raw = record.raw_data || record;
  const zone = norm(record.zone || record.from_zone || raw.zone || raw.ZONE || raw.from_zone || raw.FROM_ZONE || record.batch_zone || "");
  const division = norm(record.division || record.from_division || raw.division || raw.DVSN || raw.DIVISION || "");
  const stationFrom = norm(record.station_from || record.stationFrom || raw.station_from || raw['STTN FROM'] || raw['STATION FROM'] || "");
  const no = norm(record.odr_number || record.indent_number || record.indentNo || raw['DEMAND NO.'] || raw['NO.'] || raw['indent_no'] || raw['indent_number'] || "");
  const dateStr = normalizeKeyPart(
    record.departure_date || record.indent_date || record.demand_date || record.indentDate || raw['DEMAND DATE'] || raw['DATE'] || raw['indent_date'] || "",
    formatFoisDate
  );
  const timeStr = normalizeKeyPart(
    record.indent_time || record.demand_time || record.indentTime || raw['DEMAND TIME'] || raw['TIME'] || raw['Time'] || raw['indent_time'] || "",
    formatFoisTime
  );

  return `${zone}|${division}|${stationFrom}|${no}|${dateStr}|${timeStr}`;
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
        maturity_date: norm(record.maturity_date || record.expectedLoadingDate || record.met_with_date),
        rake_cmdt: norm(record.rake_cmdt || record.rake_commodity_code),
        wagon_type: norm(record.wagon_type),
        product: norm(record.product || record.product_code),
      }
    : {
        status: norm(record.status),
        wagons: Number(record.wagons || record.supplied_units || 0),
        supplied_units: Number(record.supplied_units || 0),
        supplied_time: norm(record.supplied_time),
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
 * Aggregate multiple destination/commodity/rake rows sharing the same parent business key
 * into a single parent indent object with line_items array preserving detail rows.
 */
export function aggregateMultiLineIndents(parsedRecords, fileType = "ODR") {
  const grouped = new Map();

  for (const record of Array.isArray(parsedRecords) ? parsedRecords : []) {
    const key = generateBusinessKey(record, fileType);
    const existing = grouped.get(key);

    const raw = record.raw_data || {};
    // Read indented_units strictly from raw ODR fields — never from record.indented_units
    // which may already be an aggregated (wrong) sum from a prior sync run.
    // Demand comes strictly from FOIS's own "Indented Units" columns — OTSG UNTS/8W
    // is a different figure (outstanding/pending balance, not the original demand)
    // and must never be substituted in as if it were the indented quantity.
    const iu = firstRealNumber([
      raw['indented_units'],
      raw['INDENTED UNTS'],
      raw['INDENTED UNITS'],
      record.indented_units,
      record.wagons_demanded,
    ]);
    // supplied_units in raw ODR represents the TOTAL rake supplied (written on one arbitrary row).
    // Track it at parent level as MAX; do NOT distribute to individual line items.
    const su = firstRealNumber([
      record.supplied_units,
      raw['SUPPLIED UNTS'],
      raw['SUPPLIED UNITS'],
      raw['supplied_units'],
    ], { requirePositive: true });

    const srNo = String(raw['srNo'] || raw['SR NO'] || raw['sr_no'] || "").trim();
    const dedupKey = srNo || `${record.station_to || record.destination || ""}|${iu}`;

    const lineItem = {
      destination: record.station_to || record.destination || "",
      station_to: record.station_to || record.destination || "",
      commodity: record.commodity || record.commodity_code || "",
      rake_cmdt: record.rake_cmdt || record.rake_commodity_code || "",
      indented_units: iu,
      supplied_units: su,
      supplied_time: record.supplied_time || raw['SUPPLIED TIME'] || raw['supplied_time'] || "",
      cnsr: record.company || record.cnsr || "",
      cnsg: record.cnsg || "",
      sr_no: srNo,
      raw_data: raw,
    };

    if (!existing) {
      grouped.set(key, {
        ...record,
        business_key: key,
        indented_units: iu,
        supplied_units: su,
        line_items: new Map([[dedupKey, lineItem]]),
      });
    } else {
      // Deduplicate: only add if this srNo not yet seen for this demand.
      if (!existing.line_items.has(dedupKey)) {
        existing.line_items.set(dedupKey, lineItem);
      }

      if (!existing.supplied_time && lineItem.supplied_time) {
        existing.supplied_time = lineItem.supplied_time;
      }

      // Unique destinations / commodities list display
      const allItems = Array.from(existing.line_items.values());
      const destSet = new Set(allItems.map(l => l.station_to).filter(Boolean));
      existing.station_to = Array.from(destSet).join(", ");
      const cmdtSet = new Set(allItems.map(l => l.commodity).filter(Boolean));
      if (cmdtSet.size > 0) existing.commodity = Array.from(cmdtSet).join(", ");
    }
  }

  // Finalise each grouped demand: convert Map → Array, compute parent totals.
  for (const item of grouped.values()) {
    const lineItemsArr = Array.from(item.line_items.values());
    item.line_items = lineItemsArr;
    item.indented_units = lineItemsArr.reduce((sum, li) => sum + (Number(li.indented_units) || 0), 0);
    item.supplied_units = lineItemsArr.reduce((sum, li) => sum + (Number(li.supplied_units) || 0), 0);
    item.wagons = Math.max(item.supplied_units, item.indented_units);
  }

  return Array.from(grouped.values());
}

/**
 * Deduplicate rows inside the same uploaded Excel file.
 * Returns { uniqueRecords, duplicateRowsCount }.
 */
export function deduplicateIntraFileRecords(parsedRecords, fileType = "ODR") {
  const aggregated = aggregateMultiLineIndents(parsedRecords, fileType);
  const totalOriginal = Array.isArray(parsedRecords) ? parsedRecords.length : 0;
  const duplicateRowsCount = totalOriginal - aggregated.length;

  return {
    uniqueRecords: aggregated,
    duplicateRowsCount,
  };
}

/**
 * Classify a batch of incoming parsed records against existing DB records.
 * Returns { newRecords, updatedRecords, unchangedRecords }
 */
export function classifyBatchRecords(parsedRecords, existingKeyMap, batchId, fileType = "ODR") {
  const aggregated = aggregateMultiLineIndents(parsedRecords, fileType);
  const newRecords = [];
  const updatedRecords = [];
  const unchangedRecords = [];

  for (const record of aggregated) {
    const businessKey = record.business_key || generateBusinessKey(record, fileType);
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


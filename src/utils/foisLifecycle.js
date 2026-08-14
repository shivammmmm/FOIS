import { formatFoisDate, formatFoisTime, isNumericCode } from "./foisDateTime.js";

function readRawValue(record, ...keys) {
  const raw = record?.raw_data || {};
  const normalizedRaw = Object.entries(raw).reduce((acc, [key, value]) => {
    acc[String(key || "").trim().toUpperCase()] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value =
      raw[key] ??
      record?.[key] ??
      normalizedRaw[String(key || "").trim().toUpperCase()];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

/**
 * Priority 1: Canonical parent field (record.indented_units)
 * Priority 2: Railway raw field (INDENTED UNTS)
 * Priority 3: line_items SUM only if parent/raw canonical value is genuinely unavailable.
 */
export function getDemandUnits(record) {
  if (!record) return "-";

  // Priority 1: Parent canonical field
  if (record.indented_units !== undefined && record.indented_units !== null && record.indented_units !== "") {
    const num = Number(record.indented_units);
    if (!isNaN(num)) return String(num);
  }

  // Priority 2: Railway raw field
  const rawVal = readRawValue(record, "Units (Demand)", "INDENTED UNTS", "indented_units", "units_demand");
  if (rawVal) {
    const num = Number(rawVal);
    if (!isNaN(num)) return String(num);
  }

  // Priority 3: Line items sum if parent/raw unavailable
  if (Array.isArray(record.line_items) && record.line_items.length > 0) {
    const sum = record.line_items.reduce((acc, item) => acc + (Number(item.indented_units || item.wagons_demanded) || 0), 0);
    if (sum > 0) return String(sum);
  }

  return record.wagons_demanded ? String(record.wagons_demanded) : "-";
}

/**
 * Priority 1: Canonical parent field (record.supplied_units)
 * Priority 2: Railway raw field (SUPPLIED UNTS)
 * Priority 3: line_items SUM only if parent/raw canonical value is genuinely unavailable.
 * Rule: NEVER fallback to demand units.
 */
export function getSuppliedUnits(record) {
  if (!record) return "0";

  // Priority 1: Parent canonical field
  if (record.supplied_units !== undefined && record.supplied_units !== null && record.supplied_units !== "") {
    const num = Number(record.supplied_units);
    if (!isNaN(num) && num > 0) return String(num);
  }

  // Priority 2: Railway raw field
  const rawVal = readRawValue(record, "Units (Supplied)", "SUPPLIED UNTS", "supplied_units", "units_supplied");
  if (rawVal) {
    const num = Number(rawVal);
    if (!isNaN(num) && num > 0) return String(num);
  }

  // Priority 3: Line items sum if parent/raw unavailable
  if (Array.isArray(record.line_items) && record.line_items.length > 0) {
    const sum = record.line_items.reduce((acc, item) => acc + (Number(item.supplied_units) || 0), 0);
    if (sum > 0) return String(sum);
  }

  // A record maturing does not prove it was ever supplied — demand units are a
  // different fact and must never stand in for a genuinely absent supplied figure.
  return "0";
}

/**
 * Supply Date / Time text from Railway record
 */
export function getSuppliedTimeText(record) {
  if (!record) return "-";
  const rawSuppliedDate = record.supplied_time || record.supplied_date || readRawValue(record, "SUPPLIED TIME", "supplied_time", "SUPPLIED DATE");
  if (!rawSuppliedDate) return "-";

  const dateVal = isNumericCode(rawSuppliedDate) ? "" : formatFoisDate(rawSuppliedDate);
  const timeVal = formatFoisTime(rawSuppliedDate);

  if (dateVal && dateVal !== "-") {
    return dateVal + (timeVal && timeVal !== "-" ? ` ${timeVal}` : "");
  }
  return "-";
}

/**
 * Combined Supply Display (e.g. "59 Units (05 Aug 2026, 05:40 PM)" or "59 Units" or "-")
 */
export function getSuppliedCombinedText(record) {
  const units = Number(getSuppliedUnits(record));
  const timeText = getSuppliedTimeText(record);

  if (units > 0 && timeText !== "-") {
    return `${units} Units (${timeText})`;
  }
  if (units > 0) {
    return `${units} Units`;
  }
  if (timeText !== "-") {
    return timeText;
  }
  return "-";
}

/**
 * Railway MET WITH DATE ONLY.
 * Rule: NEVER fallback to supplied_time, expected_loading_date, departure_date, or created_date.
 */
export function getMaturedDateText(record) {
  if (!record) return "-";
  const rawMaturedDate = record.met_with_date || readRawValue(record, "MET WITH DATE", "METWITH DATE", "met_with_date");
  if (!rawMaturedDate) return "-";

  const dateVal = isNumericCode(rawMaturedDate) ? "" : formatFoisDate(rawMaturedDate);
  if (dateVal && dateVal !== "-" && dateVal !== "null" && dateVal !== "undefined") {
    return dateVal;
  }
  return "-";
}

/**
 * Filter Helper: Supplied Record
 */
export function isSuppliedRecord(record) {
  if (!record) return false;
  const units = Number(getSuppliedUnits(record));
  const timeText = getSuppliedTimeText(record);
  return units > 0 || timeText !== "-";
}

/**
 * Filter Helper: Matured Record (MET WITH DATE ONLY)
 */
export function isMaturedRecord(record) {
  if (!record) return false;
  return getMaturedDateText(record) !== "-";
}

/**
 * Flag if Railway source data has Demand < Supply mismatch
 */
export function hasRailwayDataMismatch(record) {
  if (!record) return false;
  const demand = Number(getDemandUnits(record));
  const supply = Number(getSuppliedUnits(record));
  return !isNaN(demand) && !isNaN(supply) && supply > demand;
}

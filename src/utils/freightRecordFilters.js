import { getStationMeta } from "@/utils/stationMaster";

const WAGON_TYPE_CODES = new Set([
  "BCN",
  "BCNA",
  "BCNAHSM1",
  "BCNHL",
  "BOBR",
  "BOBRN",
  "BOBRNHSM1",
  "BOBRNHSM2",
  "BOSM",
  "BOST",
  "BOXCL",
  "BOXN",
  "BOXNEL",
  "BOXNHA",
  "BOXNHL",
  "BOXNHL25T",
  "BOXNR",
  "BTPN",
  "NMG",
  "NMGH",
]);

const RAKE_CMDT_RAW_KEYS = [
  "Rake CMDT",
  "RAKE CMDT",
  "rake_cmdt",
  "rakeCmdt",
  "Rake Commodity",
  "Rake Commodity Code",
];

export function normalizeFilterValue(value) {
  return String(value || "").trim().toUpperCase();
}

function readRawValue(record, ...keys) {
  const raw = record?.raw_data || {};
  const normalizedRaw = Object.entries(raw).reduce((acc, [key, value]) => {
    acc[normalizeFilterValue(key)] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value =
      raw[key] ??
      record?.[key] ??
      normalizedRaw[normalizeFilterValue(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export function getRecordStationCode(record, movementType) {
  if (movementType === "Inward") return record?.station_to || "";
  if (movementType === "Outward") return record?.station_from || "";
  return record?.movement_type === "Inward"
    ? record?.station_to || ""
    : record?.station_from || record?.station_to || "";
}

export function getStationMasterMetaForRecord(record, movementType) {
  return getStationMeta(getRecordStationCode(record, movementType));
}

export function getStationMasterState(record, movementType) {
  return getStationMasterMetaForRecord(record, movementType)?.state || "";
}

export function getStationMasterDistrict(record, movementType) {
  return getStationMasterMetaForRecord(record, movementType)?.district || "";
}

export function getRecordZone(record) {
  return normalizeFilterValue(record?.zone || record?.from_zone || record?.to_zone);
}

export function getRakeCmdtValue(record) {
  const candidates = [
    record?.rake_cmdt,
    record?.rake_commodity,
    record?.rake_commodity_code,
    readRawValue(record, ...RAKE_CMDT_RAW_KEYS),
  ];

  for (const candidate of candidates) {
    const value = normalizeFilterValue(candidate);
    if (!value || isWagonType(value)) continue;
    return value;
  }

  return "";
}

export function getBusinessRakeCmdtCode(record) {
  return getRakeCmdtValue(record);
}

export function getBusinessRakeCmdtDisplay(record) {
  return (
    record?.rake_commodity_name ||
    record?.rake_cmdt_name ||
    readRawValue(record, "Rake CMDT Name", "RAKE CMDT NAME", ...RAKE_CMDT_RAW_KEYS) ||
    getBusinessRakeCmdtCode(record)
  );
}

export function isWagonType(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return true;
  const normalized = normalizeFilterValue(value);
  if (/^\d+$/.test(normalized)) return true;
  if (WAGON_TYPE_CODES.has(normalized)) return true;
  return /^(BOX|BOB|BOS|BCN|BTP|NMG)/.test(normalized);
}

export function uniqueSortedOptions(values) {
  return ["All", ...new Set(values.map(normalizeFilterValue).filter(Boolean))].sort();
}

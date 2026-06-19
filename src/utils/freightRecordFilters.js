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

export function normalizeFilterValue(value) {
  return String(value || "").trim().toUpperCase();
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
    record?.rake_commodity_code,
    record?.raw_data?.rake_cmdt,
    record?.raw_data?.rakeCmdt,
    record?.raw_data?.["RAKE CMDT"],
    record?.rake_type,
    record?.commodity,
  ];

  for (const candidate of candidates) {
    const value = normalizeFilterValue(candidate);
    if (!value || isWagonType(value)) continue;
    return value;
  }

  return "";
}

export function isWagonType(value) {
  if (/^\d+$/.test(value)) return true;
  if (WAGON_TYPE_CODES.has(value)) return true;
  return /^(BOX|BOB|BOS|BCN|BTP|NMG)/.test(value);
}

export function uniqueSortedOptions(values) {
  return ["All", ...new Set(values.map(normalizeFilterValue).filter(Boolean))].sort();
}

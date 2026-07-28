export const INTERNAL_STATUSES = [
  "Pending", "Matched", "Partial", "Completed", "Duplicate", "Manual Review", "Unmatched",
];

export const USER_STATUS = {
  Pending: "Pending",
  Matched: "Matured",
  Partial: "Partially Supplied",
  Completed: "Completed",
  "Manual Review": "Under Verification",
};

export function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function lifecycleUnits(odr = {}, matured = {}) {
  odr = odr || {};
  matured = matured || {};
  const raw = odr.raw_data || {};
  const maturedRaw = matured.raw_data || {};
  const indented = numberValue(
    raw.indented_units || raw.indented_8w || matured.wagons_demanded ||
    maturedRaw.indented_units || maturedRaw.indented_8w
  );
  const supplied = numberValue(
    raw.supplied_units || odr.supplied_units || matured.supplied_units ||
    maturedRaw.supplied_units
  );
  return {
    indented_units: indented,
    supplied_units: supplied,
    balance_units: Math.max(indented - supplied, 0),
    over_supplied: indented > 0 && supplied > indented,
  };
}

export function matchedLifecycleStatus(odr, matured, fallback = "Matched") {
  const units = lifecycleUnits(odr, matured);
  if (units.indented_units > 0 && units.supplied_units >= units.indented_units) return "Completed";
  if (units.supplied_units > 0 && units.supplied_units < units.indented_units) return "Partial";
  return fallback;
}

export function toUserStatus(internalStatus) {
  return USER_STATUS[internalStatus] || null;
}

export function statusVersion(record = {}) {
  const units = lifecycleUnits(record.odr || {}, record.matured || {});
  return [
    record.status || "",
    units.indented_units,
    units.supplied_units,
    record.updated_date || record.matched_on || "",
  ].join(":");
}

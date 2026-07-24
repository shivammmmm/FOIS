const normalizeCode = (code) => String(code || '').trim().toUpperCase();

// Populated at runtime from records fetched from the database (see
// registerStationMetaFromRecords). No hardcoded station data lives here —
// unmapped codes fall back to showing the raw code itself.
export const STATION_MASTER = {};

export function registerStationMetaFromRecords(records = []) {
  for (const record of Array.isArray(records) ? records : []) {
    registerStation(record.station_from, {
      name: record.from_station_name,
      division: record.from_division || record.division,
      district: record.from_district,
      state: record.from_state,
    });
    registerStation(record.station_to, {
      name: record.to_station_name,
      division: record.to_division || record.division,
      district: record.to_district,
      state: record.to_state,
    });
  }
}

function registerStation(code, metadata = {}) {
  const upper = normalizeCode(code);
  if (!upper) return;
  const existing = STATION_MASTER[upper] || { code: upper, name: upper };
  STATION_MASTER[upper] = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
    code: upper,
  };
}

export function getStationMeta(code) {
  const upper = normalizeCode(code);
  if (!upper) return null;
  const meta = STATION_MASTER[upper];
  if (!meta) return { code: upper, name: upper, district: '', state: '' };
  return {
    code: upper,
    name: meta.name || upper,
    division: meta.division || '',
    district: meta.district || '',
    state: meta.state || '',
    category: meta.category || '',
    source: meta.source || '',
  };
}

export function getStationFullName(code) {
  return getStationMeta(code)?.name || code || '-';
}

export function getStationDistrict(code) {
  return getStationMeta(code)?.district || '';
}

export function getStationState(code) {
  return getStationMeta(code)?.state || '';
}

export function formatStationNameAndCode(code) {
  const meta = getStationMeta(code);
  if (!meta) return '-';
  return meta.name === meta.code ? meta.code : `${meta.name} (${meta.code})`;
}

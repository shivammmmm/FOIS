import { GENERATED_STATION_MASTER } from '@/data/stationMaster.generated';
import { STATION_MASTER_OVERRIDES } from '@/data/stationMasterOverrides';
import { STATION_NAMES } from './railwayDictionary';

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

const LEGACY_STATION_MASTER = Object.fromEntries(
  Object.entries(STATION_NAMES).map(([code, name]) => [code, { code, name }])
);

export const STATION_MASTER = {
  ...LEGACY_STATION_MASTER,
  ...GENERATED_STATION_MASTER,
  ...STATION_MASTER_OVERRIDES,
};

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

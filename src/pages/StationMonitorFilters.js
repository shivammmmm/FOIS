// Shared helpers for Station hierarchy + commodity cascade + unmapped fallback.
// This file is used by Inward/Outward Monitor and Notifications.

import { getStationMeta, formatStationNameAndCode } from '@/utils/stationMaster';
import { COMMODITY_DICTIONARY } from '@/constants/commodityDictionary';
import { getCommodityName } from '@/utils/railwayDictionary';

// Commodity cascade source is derived dynamically from existing FreightMovement records.
// This module only computes hierarchy from the records payload; it does not hardcode.

export const getCoalFertMapping = () => {
  // Intentionally empty: cascade rules must be derived from actual commodity metadata source.
  // Keeping placeholder to avoid hardcoding in this module.
  return null;
};

export function normalizeStationCode(code) {
  const s = String(code ?? '').trim().toUpperCase();
  return s || null;
}

export function buildStationHierarchyFromMasters(mastersByCode) {
  const zoneSet = new Set();
  const divisionSetByZone = new Map();
  const stateSetByDivision = new Map();
  const districtSetByState = new Map();
  const stationSetByDistrict = new Map();

  for (const [code, meta] of Object.entries(mastersByCode || {})) {
    const zone = meta?.zone || '';
    const division = meta?.division || '';
    const state = meta?.state || '';
    const district = meta?.district || '';

    const station = meta?.station_code || code;

    if (!zone && !division && !state && !district) continue;

    zoneSet.add(zone || '');

    if (zone) {
      if (!divisionSetByZone.has(zone)) divisionSetByZone.set(zone, new Set());
      if (division) divisionSetByZone.get(zone).add(division);
    }

    if (division) {
      if (!stateSetByDivision.has(division)) stateSetByDivision.set(division, new Set());
      if (state) stateSetByDivision.get(division).add(state);
    }

    if (state) {
      if (!districtSetByState.has(state)) districtSetByState.set(state, new Set());
      if (district) districtSetByState.get(state).add(district);
    }

    if (district) {
      if (!stationSetByDistrict.has(district)) stationSetByDistrict.set(district, new Set());
      if (station) stationSetByDistrict.get(district).add(station);
    }
  }

  return {
    zoneOptions: ['All', ...[...zoneSet].filter(Boolean).sort()],
    divisionOptions: (zone) => {
      if (!zone || zone === 'All') {
        const s = new Set();
        for (const v of divisionSetByZone.values()) for (const x of v) s.add(x);
        return ['All', ...[...s].sort()];
      }
      return ['All', ...(divisionSetByZone.get(zone) ? [...divisionSetByZone.get(zone)] : []).sort()];
    },
    stateOptions: (division) => {
      if (!division || division === 'All') {
        const s = new Set();
        for (const v of stateSetByDivision.values()) for (const x of v) s.add(x);
        return ['All', ...[...s].sort()];
      }
      return ['All', ...(stateSetByDivision.get(division) ? [...stateSetByDivision.get(division)] : []).sort()];
    },
    districtOptions: (state) => {
      if (!state || state === 'All') {
        const s = new Set();
        for (const v of districtSetByState.values()) for (const x of v) s.add(x);
        return ['All', ...[...s].sort()];
      }
      return ['All', ...(districtSetByState.get(state) ? [...districtSetByState.get(state)] : []).sort()];
    },
    stationOptions: (district) => {
      if (!district || district === 'All') {
        const s = new Set();
        for (const v of stationSetByDistrict.values()) for (const x of v) s.add(x);
        return ['All', ...[...s].sort()];
      }
      return ['All', ...(stationSetByDistrict.get(district) ? [...stationSetByDistrict.get(district)] : []).sort()];
    },
  };
}

export function resolveStationDisplay(code, mastersByCode) {
  const meta = mastersByCode?.[code] || getStationMeta(code);
  if (meta?.name && meta?.code && meta.name !== meta.code) return `${meta.name} (${meta.code})`;
  return meta?.name || code || '-';
}

// Unmapped fallback: if station not in mastersByCode, display code and name from movement record.
// The filter logic must still include the movement when station code is searched.
export function stationMatchesFilter({ stationCode, stationName, mastersByCode }, filterValue) {
  const normalized = normalizeStationCode(stationCode);
  if (!filterValue || filterValue === 'All') return true;
  if (filterValue && normalized && normalized === normalizeStationCode(filterValue)) return true;

  // If masters missing, allow matching by station_name as well.
  if (!mastersByCode?.[normalized]) {
    if (stationName && String(stationName).toLowerCase().includes(String(filterValue).toLowerCase())) return true;
  }

  return false;
}

// Commodity cascade must be derived from record payload.
// Here we derive a mapping from commodity_group to commodity.
export function buildCommodityCascadeFromRecords(records) {
  const groups = new Set();
  const commoditiesByGroup = new Map();

  for (const r of records || []) {
    const group = r.commodity_group || 'General/Other';
    const commodity = r.commodity;
    if (!commodity) continue;
    groups.add(group);
    if (!commoditiesByGroup.has(group)) commoditiesByGroup.set(group, new Set());
    commoditiesByGroup.get(group).add(commodity);
  }

  return {
    commodityGroupOptions: ['All', ...[...groups].filter(Boolean).sort()],
    commodityOptionsForGroup: (group) => {
      if (!group || group === 'All') {
        const s = new Set();
        for (const v of commoditiesByGroup.values()) for (const x of v) s.add(x);
        return ['All', ...[...s].sort()];
      }
      const set = commoditiesByGroup.get(group);
      return ['All', ...(set ? [...set] : [])].sort();
    },
    // For display, re-use railwayDictionary getCommodityName
    getCommodityLabel: (code) => {
      if (!code || code === 'All') return 'All';
      return `${getCommodityName(code)} (${code})`;
    },
  };
}

export function getCommodityGroupForCommodity(records, commodityCode) {
  const c = String(commodityCode ?? '').trim();
  if (!c) return null;
  const found = (records || []).find(r => r.commodity === c);
  return found?.commodity_group || 'General/Other';
}

export function getCommodityGroupOptionsSorted(records) {
  const set = new Set();
  for (const r of records || []) {
    const g = r.commodity_group || 'General/Other';
    if (g) set.add(g);
  }
  return ['All', ...[...set].sort()];
}

export function normalizeCommodityCode(code) {
  return String(code ?? '').trim().toUpperCase();
}


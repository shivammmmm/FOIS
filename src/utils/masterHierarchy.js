import { useSyncExternalStore } from "react";
import { base44 } from "@/api/base44Client";

// Single shared cache of zone/division/station/commodity code -> name,
// sourced from zone_master, division_master, station_master and
// commodity_master. No hardcoded data lives here: a code with no master
// entry resolves to itself (the raw uploaded code).
let state = { zones: {}, divisions: {}, divisionParentZone: {}, stations: {}, commodities: {}, raw: null };
const listeners = new Set();

function setState(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

let loadPromise = null;
export function loadMasterHierarchy() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all([
    base44.filterHierarchy(),
    base44.readOnlyMasters.stations().catch(() => ({ items: [] })),
    base44.readOnlyMasters.commodities().catch(() => ({ items: [] })),
  ])
    .then(([data, stationData, commodityData]) => {
      setState({
        zones: Object.fromEntries((data?.zones || []).map((z) => [z.code, z.name])),
        divisions: Object.fromEntries((data?.divisions || []).map((d) => [d.code, d.name])),
        // Uploaded files carry no real zone column; zone is only knowable
        // via the division's parent zone in division_master.
        divisionParentZone: Object.fromEntries(
          (data?.divisions || []).filter((d) => d.parentCode).map((d) => [d.code, d.parentCode])
        ),
        stations: Object.fromEntries(
          (stationData?.items || []).map((s) => [s.station_code, s.station_name])
        ),
        commodities: Object.fromEntries(
          (commodityData?.items || []).map((c) => [c.code, c.full_name || c.name])
        ),
        // Raw filterHierarchy() response — kept so consumers that need the
        // full {code,name,parentCode} shape (e.g. buildFilterHierarchyOptions
        // for cascading filter dropdowns) don't have to issue a second,
        // duplicate /api/filter-hierarchy request for data already fetched.
        raw: data,
      });
    })
    .catch(() => undefined);
  return loadPromise;
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return state;
}

export function getZoneName(code) {
  if (!code) return code;
  return state.zones[code] || code;
}

export function getDivisionName(code) {
  if (!code) return code;
  return state.divisions[code] || code;
}

// Zone for a division code, resolved through division_master.parent_code ->
// zone_master. Returns "" (not the division code) when the division isn't
// mapped, since a division code is never a valid zone.
export function getZoneForDivision(divisionCode) {
  if (!divisionCode) return "";
  const zoneCode = state.divisionParentZone[divisionCode];
  return zoneCode ? getZoneName(zoneCode) : "";
}

export function getStationName(code) {
  if (!code) return code;
  return state.stations[code] || code;
}

export function getCommodityName(code) {
  if (!code) return code;
  return state.commodities[code] || code;
}

export function useMasterHierarchy() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return {
    zones: snapshot.zones,
    divisions: snapshot.divisions,
    stations: snapshot.stations,
    commodities: snapshot.commodities,
    raw: snapshot.raw,
    getZoneName: (code) => (code ? snapshot.zones[code] || code : code),
    getDivisionName: (code) => (code ? snapshot.divisions[code] || code : code),
    getStationName: (code) => (code ? snapshot.stations[code] || code : code),
    getCommodityName: (code) => (code ? snapshot.commodities[code] || code : code),
    getZoneForDivision: (divisionCode) => {
      if (!divisionCode) return "";
      const zoneCode = snapshot.divisionParentZone[divisionCode];
      return zoneCode ? snapshot.zones[zoneCode] || zoneCode : "";
    },
  };
}

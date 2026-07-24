import { isWagonType, normalizeFilterValue } from "@/utils/freightRecordFilters";

const option = (value, label) => ({ value, label: label && label !== value ? `${label} (${value})` : value, searchText: `${value} ${label || ""}` });

export function buildFilterHierarchyOptions(source = {}, selected = {}) {
  const states = source.states || [];
  const selectedStates = new Set(selected.states || selected.state || []);
  const districts = (source.districts || []).filter((row) => !selectedStates.size || selectedStates.has(row.parentCode));
  const selectedDistricts = new Set(selected.districts || selected.district || []);
  const selectedCommodities = new Set(selected.commodities || selected.commodity || []);
  const rakes = (source.rakes || []).filter((row) =>
    !isWagonType(row.code) && (!selectedCommodities.size || row.commodities.some((code) => selectedCommodities.has(code)))
  );
  const zones = source.zones || [];
  const selectedZones = new Set(selected.zones || selected.zone || []);
  // Divisions with no known zone (not yet in division_master) can't be
  // confirmed to belong to a selected zone, so they're excluded once a zone
  // filter is active rather than leaking through unfiltered.
  const divisions = (source.divisions || []).filter(
    (row) => !selectedZones.size || selectedZones.has(row.parentCode)
  );
  const selectedDivisions = new Set(selected.divisions || selected.division || []);
  const stations = (source.stations || []).filter((row) =>
    (!selectedStates.size || selectedStates.has(row.state))
    && (!selectedDistricts.size || selectedDistricts.has(row.district))
    && (!selectedDivisions.size || selectedDivisions.has(row.division))
  );
  return {
    states: states.map((row) => option(row.code, row.name)),
    districts: districts.map((row) => option(row.code, row.name)),
    stations: stations.map((row) => option(row.code, row.name)),
    commodities: (source.commodities || []).map((row) => option(row.code, row.name)),
    rakeCmdts: rakes.map((row) => option(row.code, row.name)),
    zones: zones.map((row) => option(row.code, row.name)),
    divisions: divisions.map((row) => option(row.code, row.name)),
  };
}

export function normalizeHierarchyCode(value) {
  return normalizeFilterValue(value);
}

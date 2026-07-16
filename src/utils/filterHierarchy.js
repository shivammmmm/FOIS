import { isWagonType, normalizeFilterValue } from "@/utils/freightRecordFilters";

const option = (value, label) => ({ value, label: label && label !== value ? `${label} (${value})` : value, searchText: `${value} ${label || ""}` });

export function buildFilterHierarchyOptions(source = {}, selected = {}) {
  const states = source.states || [];
  const selectedStates = new Set(selected.states || selected.state || []);
  const districts = (source.districts || []).filter((row) => !selectedStates.size || selectedStates.has(row.parentCode));
  const selectedDistricts = new Set(selected.districts || selected.district || []);
  const stations = (source.stations || []).filter((row) =>
    (!selectedStates.size || selectedStates.has(row.state)) && (!selectedDistricts.size || selectedDistricts.has(row.district))
  );
  const selectedCommodities = new Set(selected.commodities || selected.commodity || []);
  const rakes = (source.rakes || []).filter((row) =>
    !isWagonType(row.code) && (!selectedCommodities.size || row.commodities.some((code) => selectedCommodities.has(code)))
  );
  return {
    states: states.map((row) => option(row.code, row.name)),
    districts: districts.map((row) => option(row.code, row.name)),
    stations: stations.map((row) => option(row.code, row.name)),
    commodities: (source.commodities || []).map((row) => option(row.code, row.name)),
    rakeCmdts: rakes.map((row) => option(row.code, row.name)),
  };
}

export function normalizeHierarchyCode(value) {
  return normalizeFilterValue(value);
}

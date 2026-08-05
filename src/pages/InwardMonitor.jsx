import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Save, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import FreightDetailsModal from "@/components/FreightDetailsModal";
import { useAuth } from "@/lib/AuthContext";
import {
  getBusinessRakeCmdtDisplay as getRakeCmdtDisplay,
} from "@/utils/freightRecordFilters";
import { formatStationNameAndCode, getStationMeta, registerStationMetaFromRecords } from "@/utils/stationMaster";
import { buildFilterHierarchyOptions } from "@/utils/filterHierarchy";
import { formatFoisDateTime } from "@/utils/foisDateTime";
import {
  clearPersistentFilters,
  hasSavedFilterValues,
  normalizeMultiValue,
  readPersistentFilters,
  writePersistentFilters,
} from "@/utils/persistentFilters";

const PER_PAGE = 25;
const FILTER_SOURCE = "inwardMonitor";
const SAVED_SOURCE = "Inward Monitor";

const DEFAULT_FILTERS = {
  search: "",
  zone: [],
  division: [],
  states: [],
  districts: [],
  stations: [],
  commodities: [],
  rakeCmdts: [],
};

export default function InwardMonitor() {
  const { user } = useAuth();
  const didLoadPersisted = useRef(false);
  const [allRecords, setAllRecords] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [options, setOptions] = useState({ commodities: [], rakeCmdts: [] });
  const [hierarchy, setHierarchy] = useState(null);

  const scoped = buildFilterHierarchyOptions(hierarchy || {}, {
    zone: filters.zone,
    division: filters.division,
    state: filters.states,
    district: filters.districts,
    commodity: filters.commodities,
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await base44.movements.page({ direction: "Inward", page, limit: PER_PAGE, search: filters.search, division: filters.division, state: filters.states, district: filters.districts, station: filters.stations, commodity: filters.commodities, rake: filters.rakeCmdts });
        registerStationMetaFromRecords(data.items || []);
        setAllRecords(data.items || []);
        setTotalRecords(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } catch (error) {
        console.error("[InwardMonitor] load failed:", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [page, filters]);

  useEffect(() => {
    Promise.all([
      base44.movements.dashboardSummary({ direction: "Inward" }),
      base44.filterHierarchy("Inward"),
      user?.id ? base44.entities.SavedFilter.filter({ user_id: user.id }, "-created_at", 100) : Promise.resolve([]),
    ]).then(([summary, hierarchyData, rows]) => {
      const source = summary.options || {};
      setOptions({ commodities: source.commodity || [], rakeCmdts: source.rake || [] });
      setHierarchy(hierarchyData);
      setSavedFilters((rows || []).filter((row) => row.source === SAVED_SOURCE));
    }).catch((error) => console.error("[InwardMonitor] options load failed:", error));
  }, [user?.id]);

  useEffect(() => {
    if (didLoadPersisted.current || !user?.id) return;
    didLoadPersisted.current = true;
    const persisted = readPersistentFilters(FILTER_SOURCE, user.id);
    if (persisted) applyFilterState(persisted);
  }, [user?.id]);

  const pageRecords = allRecords;
  const hasActiveFilters = hasSavedFilterValues(filters);

  function resetPage() {
    setPage(1);
  }

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
    resetPage();
  }

  function applyFilterState(nextFilters) {
    setFilters({
      search: nextFilters.search || "",
      zone: normalizeMultiValue(nextFilters.zone ?? nextFilters.filterZone),
      division: normalizeMultiValue(nextFilters.division ?? nextFilters.filterDivision),
      states: normalizeMultiValue(nextFilters.states ?? nextFilters.filterState),
      districts: normalizeMultiValue(nextFilters.districts ?? nextFilters.filterDistrict),
      stations: normalizeMultiValue(nextFilters.stations ?? nextFilters.selectedStations),
      commodities: normalizeMultiValue(nextFilters.commodities ?? nextFilters.filterComm),
      rakeCmdts: normalizeMultiValue(nextFilters.rakeCmdts ?? nextFilters.filterRakeCmdt),
    });
    resetPage();
  }

  async function saveCurrentFilter() {
    if (!user?.id) return;
    writePersistentFilters(FILTER_SOURCE, user.id, filters);
    const saved = await base44.entities.SavedFilter.create({
      user_id: user.id,
      name: buildFilterName(filters),
      source: SAVED_SOURCE,
      filters,
    });
    setSavedFilters((prev) => [saved, ...prev]);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    if (user?.id) clearPersistentFilters(FILTER_SOURCE, user.id);
    resetPage();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-emerald-400" />
            <h1 className="text-2xl font-bold text-foreground">Inward Monitor</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Freight arriving at stations, plants &amp; sidings
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <MultiSelectFilter
            label="Zone"
            selected={filters.zone}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, zone: value, division: [], stations: [] }));
              resetPage();
            }}
            options={scoped.zones}
            placeholder="All Zones"
          />
          <MultiSelectFilter
            label="Division"
            selected={filters.division}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, division: value, stations: [] }));
              resetPage();
            }}
            options={scoped.divisions}
            placeholder="All Divisions"
          />

          <MultiSelectFilter label="State" selected={filters.states} onChange={(value) => { setFilters((prev) => ({ ...prev, states: value, districts: [], stations: [] })); resetPage(); }} options={scoped.states} placeholder="All States" />
          <MultiSelectFilter label="District" selected={filters.districts} onChange={(value) => { setFilters((prev) => ({ ...prev, districts: value, stations: [] })); resetPage(); }} options={scoped.districts} placeholder="All Districts" />
          <MultiSelectFilter label="Station" selected={filters.stations} onChange={(value) => setFilter("stations", value)} options={scoped.stations} placeholder="All Stations" align="right" />
          <MultiSelectFilter
            label="Commodity"
            selected={filters.commodities}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, commodities: value, rakeCmdts: [] }));
              resetPage();
            }}
            options={options.commodities}
            placeholder="All Commodities"
          />
          <MultiSelectFilter label="Rake Commodity" selected={filters.rakeCmdts} onChange={(value) => {
            setFilters((prev) => ({ ...prev, rakeCmdts: value }));
            resetPage();
          }} options={scoped.rakeCmdts.length ? scoped.rakeCmdts : options.rakeCmdts} placeholder="All Rake Commodities" />

          {savedFilters.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                const saved = savedFilters.find((item) => item.id === event.target.value);
                if (saved?.filters) applyFilterState(saved.filters);
              }}
              className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">Apply Saved Filter</option>
              {savedFilters.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={saveCurrentFilter}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            <Save className="h-3.5 w-3.5" />
            Save Filter
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <input
          value={filters.search}
          onChange={(event) => setFilter("search", event.target.value)}
          placeholder="Search Unique Code, FNR, station, division, commodity, company..."
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filters.stations.length > 0 && (
        <ActiveStationChips
          label="Active Stations"
          stations={filters.stations}
          onRemove={(station) =>
            setFilter(
              "stations",
              filters.stations.filter((item) => item !== station)
            )
          }
        />
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold text-foreground">Inward Records</h3>
          <span className="text-xs text-muted-foreground">
            {totalRecords} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Unique Code",
                  "Rake Inward / FNR",
                  "Destination Station",
                  "District (To)",
                  "State (To)",
                  "Company",
                  "Commodity",
                  "Rake Commodity (Rake CMDT)",
                  "Wagons",
                  "Source Station",
                  "Departure Date (Demand Date)",
                  "Arrival Date & Time",
                ].map((header) => (
                  <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, row) => (
                  <tr key={row} className="border-b border-border/50">
                    {[...Array(12)].map((__, col) => (
                      <td key={col} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRecords.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No inward records.
                  </td>
                </tr>
              ) : (
                pageRecords.map((record, idx) => (
                  <tr key={record.id} onClick={() => setSelectedRecord(record)} className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {record.unique_rake_code || `Rake/${String(idx + 1).padStart(2, '0')} (No.${getFnr(record)} | ${record.departure_date || '-'})`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{getFnr(record)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-emerald-700">{formatStationNameAndCode(record.station_to)}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getDestinationDistrict(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getDestinationState(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getCompanyDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground font-semibold">{record.commodity || getProductDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getRakeCmdtDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{record.wagons || "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatStationNameAndCode(record.station_from)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-medium">{record.departure_date || "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(record.arrival_date, readRaw(record, "Arrival Time", "UpdatedTime")) || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && totalRecords > 0 && totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} totalRecords={totalRecords} onPage={setPage} />
        )}
      </div>

      <FreightDetailsModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

function readRaw(record, ...keys) {
  for (const key of keys) {
    const value = record?.raw_data?.[key] ?? record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function getCommodityCode(record) {
  return String(record.commodity_code || record.commodity || readRaw(record, "CMDT", "Commodity") || "").trim();
}

function getCommodityDisplay(record) {
  return record.commodity_name || readRaw(record, "CMDT", "Commodity", "Commodity Name") || record.commodity || record.commodity_code || "";
}

function getCompanyDisplay(record) {
  return (
    record.company_name ||
    record.company_full_name ||
    record.company ||
    record.company_code ||
    readRaw(record, "Company", "Company Name", "CompanyName", "CNSR", "cnsr", "Consignor", "Consignor Code", "Consignor Name") ||
    ""
  );
}

function getProductDisplay(record) {
  return (
    record.product_name ||
    record.product_code ||
    record.product ||
    readRaw(record, "Product", "Product Name", "ProductName", "Product Code", "ProductCode") ||
    ""
  );
}

function getDestinationState(record) {
  return record.to_state || readRaw(record, "State (To)", "State To", "StateTo") || getStationMeta(record.station_to)?.state || "";
}

function getDestinationDistrict(record) {
  return record.to_district || readRaw(record, "District (To)", "District To", "DistrictTo") || getStationMeta(record.station_to)?.district || "";
}

function getFnr(record) {
  return readRaw(record, "FNR", "FNR No", "FNR Number") || record.fnr || record.odr_number || "";
}

const formatDateTime = formatFoisDateTime;

function buildFilterName(filters) {
  const parts = [
    filters.search,
    ...filters.division,
    ...filters.states,
    ...filters.districts,
    ...filters.stations,
    ...filters.commodities,
    ...filters.rakeCmdts,
  ].filter(Boolean);
  return parts.slice(0, 4).join(" + ") || "Inward Monitor Filter";
}

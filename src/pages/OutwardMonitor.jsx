import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpFromLine, Save, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import FreightDetailsModal from "@/components/FreightDetailsModal";
import { useAuth } from "@/lib/AuthContext";
import { getDivisionName } from "@/utils/railwayDictionary";
import {
  getBusinessRakeCmdtCode as getRakeCmdtCode,
  getBusinessRakeCmdtDisplay as getRakeCmdtDisplay,
} from "@/utils/freightRecordFilters";
import { formatStationNameAndCode, getStationMeta } from "@/utils/stationMaster";
import {
  clearPersistentFilters,
  hasSavedFilterValues,
  normalizeMultiValue,
  optionMatches,
  readPersistentFilters,
  writePersistentFilters,
} from "@/utils/persistentFilters";

const PER_PAGE = 25;
const FILTER_SOURCE = "outwardMonitor";
const SAVED_SOURCE = "Outward Monitor";

const DEFAULT_FILTERS = {
  search: "",
  division: "All",
  states: [],
  districts: [],
  stations: [],
  commodities: [],
  rakeCmdts: [],
  fromDate: "",
  toDate: "",
};

export default function OutwardMonitor() {
  const { user } = useAuth();
  const didLoadPersisted = useRef(false);
  const [allRecords, setAllRecords] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await base44.entities.FreightMovement.list("-created_date", 50000);
        const outwardOnly = (data || []).filter((record) => record.movement_type === "Outward");
        setAllRecords(outwardOnly);
        if (user?.id) {
          const rows = await base44.entities.SavedFilter.filter(
            { user_id: user.id },
            "-created_at",
            100
          );
          setSavedFilters((rows || []).filter((row) => row.source === SAVED_SOURCE));
        }
      } catch (error) {
        console.error("[OutwardMonitor] load failed:", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id]);

  useEffect(() => {
    if (didLoadPersisted.current || !user?.id) return;
    didLoadPersisted.current = true;
    const persisted = readPersistentFilters(FILTER_SOURCE, user.id);
    if (persisted) applyFilterState(persisted);
  }, [user?.id]);

  const options = useMemo(() => {
    const scopedByDivision =
      filters.division === "All"
        ? allRecords
        : allRecords.filter((record) => record.division === filters.division);

    const commodityScoped =
      filters.commodities.length === 0
        ? allRecords
        : allRecords.filter((record) => filters.commodities.includes(getCommodityCode(record)));

    const states = new Set();
    const districts = new Set();
    const stations = new Map();
    const commodities = new Map();
    const rakeCmdts = new Map();

    scopedByDivision.forEach((record) => {
      const state = getSourceState(record);
      const district = getSourceDistrict(record);
      if (state) states.add(state);
      if (filters.states.length === 0 || filters.states.includes(state)) {
        if (district) districts.add(district);
      }
      if (record.station_from) {
        stations.set(record.station_from, formatStationNameAndCode(record.station_from));
      }
    });

    allRecords.forEach((record) => {
      const commodityCode = getCommodityCode(record);
      if (commodityCode) commodities.set(commodityCode, getCommodityDisplay(record));

    });

    commodityScoped.forEach((record) => {
      const rakeCmdt = getRakeCmdtCode(record);
      if (rakeCmdt) rakeCmdts.set(rakeCmdt, getRakeCmdtDisplay(record));
    });

    return {
      divisions: ["All", ...new Set(allRecords.map((record) => record.division).filter(Boolean))].sort(),
      states: [...states].sort(),
      districts: [...districts].sort(),
      stations: mapOptions(stations),
      commodities: mapOptions(commodities),
      rakeCmdts: mapOptions(rakeCmdts),
    };
  }, [allRecords, filters.commodities, filters.division, filters.states]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();

    return allRecords.filter((record) => {
      const departureDate = record.departure_date || "";
      const state = getSourceState(record);
      const district = getSourceDistrict(record);

      const matchDates =
        (!filters.fromDate || departureDate >= filters.fromDate) &&
        (!filters.toDate || departureDate <= filters.toDate);

      return (
        recordMatchesSearch(record, q) &&
        (filters.division === "All" || record.division === filters.division) &&
        optionMatches(filters.states, state) &&
        optionMatches(filters.districts, district) &&
        optionMatches(filters.stations, record.station_from || "") &&
        optionMatches(filters.commodities, getCommodityCode(record)) &&
        optionMatches(filters.rakeCmdts, getRakeCmdtCode(record)) &&
        matchDates
      );
    });
  }, [allRecords, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRecords = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
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
      division: nextFilters.division || nextFilters.filterDivision || "All",
      states: normalizeMultiValue(nextFilters.states ?? nextFilters.filterState),
      districts: normalizeMultiValue(nextFilters.districts ?? nextFilters.filterDistrict),
      stations: normalizeMultiValue(nextFilters.stations ?? nextFilters.selectedStations),
      commodities: normalizeMultiValue(nextFilters.commodities ?? nextFilters.filterComm),
      rakeCmdts: normalizeMultiValue(nextFilters.rakeCmdts ?? nextFilters.filterRakeCmdt),
      fromDate: nextFilters.fromDate || "",
      toDate: nextFilters.toDate || "",
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
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ArrowUpFromLine className="h-5 w-5 text-blue-400" />
            <h1 className="text-2xl font-bold text-foreground">Outward Monitor</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Freight dispatched from stations, plants &amp; yards
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <select
            value={filters.division}
            onChange={(event) => {
              setFilters((prev) => ({
                ...prev,
                division: event.target.value,
                states: [],
                districts: [],
                stations: [],
              }));
              resetPage();
            }}
            className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none"
          >
            {options.divisions.map((division) => (
              <option key={division} value={division}>
                {division === "All" ? "All Divisions" : `${getDivisionName(division)} (${division})`}
              </option>
            ))}
          </select>

          <DateInput label="From Date" value={filters.fromDate} onChange={(value) => setFilter("fromDate", value)} />
          <DateInput label="To Date" value={filters.toDate} onChange={(value) => setFilter("toDate", value)} />

          <MultiSelectFilter label="State" selected={filters.states} onChange={(value) => setFilter("states", value)} options={options.states} placeholder="All States" />
          <MultiSelectFilter label="District" selected={filters.districts} onChange={(value) => setFilter("districts", value)} options={options.districts} placeholder="All Districts" />
          <MultiSelectFilter label="Station" selected={filters.stations} onChange={(value) => setFilter("stations", value)} options={options.stations} placeholder="All Stations" align="right" />
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
          <MultiSelectFilter label="Rake CMDT" selected={filters.rakeCmdts} onChange={(value) => {
            setFilters((prev) => ({ ...prev, rakeCmdts: value }));
            resetPage();
          }} options={options.rakeCmdts} placeholder="All Rake CMDT" />

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
          placeholder="Search FNR, station, division, commodity, company..."
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
          <h3 className="font-semibold text-foreground">Outward Records</h3>
          <span className="text-xs text-muted-foreground">
            {filtered.length} records{filtered.length !== allRecords.length && ` (filtered from ${allRecords.length})`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  "Rake Outward / FNR",
                  "Source Station",
                  "District (Source)",
                  "State (Source)",
                  "Company",
                  "Product",
                  "Rake CMDT",
                  "Wagons",
                  "Destination Station",
                  "Departure Date",
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
                    {[...Array(11)].map((__, col) => (
                      <td key={col} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRecords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No outward records.
                  </td>
                </tr>
              ) : (
                pageRecords.map((record) => (
                  <tr key={record.id} onClick={() => setSelectedRecord(record)} className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{getFnr(record)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-blue-700">{formatStationNameAndCode(record.station_from)}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getSourceDistrict(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getSourceState(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getCompanyDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getProductDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getRakeCmdtDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{record.wagons || "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatStationNameAndCode(record.station_to)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(record.departure_date, readRaw(record, "Departure Time", "Time")) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(record.arrival_date, readRaw(record, "Arrival Time", "UpdatedTime")) || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} totalRecords={filtered.length} onPage={setPage} />
        )}
      </div>

      <FreightDetailsModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

function DateInput({ label, value, onChange }) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none"
      />
    </label>
  );
}

function ActiveStationChips({ label, stations, onRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}:</span>
      {stations.map((station) => (
        <span key={station} className="inline-flex items-center gap-1 rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {formatStationNameAndCode(station)}
          <button type="button" onClick={() => onRemove(station)} className="ml-0.5 font-bold hover:text-destructive">x</button>
        </span>
      ))}
    </div>
  );
}

function Pagination({ page, totalPages, totalRecords, onPage }) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
      <span className="text-xs text-muted-foreground">
        Page {page} of {totalPages} - {totalRecords} records
      </span>
      <div className="flex gap-2">
        <PageButton onClick={() => onPage(1)} disabled={page === 1}>First</PageButton>
        <PageButton onClick={() => onPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Prev</PageButton>
        <PageButton onClick={() => onPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>Next</PageButton>
        <PageButton onClick={() => onPage(totalPages)} disabled={page === totalPages}>Last</PageButton>
      </div>
    </div>
  );
}

function PageButton({ children, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded border border-border bg-muted px-3 py-1 text-xs text-foreground hover:bg-muted/80 disabled:opacity-40">
      {children}
    </button>
  );
}

function recordMatchesSearch(record, query) {
  if (!query) return true;
  return [
    getFnr(record),
    record.division,
    record.station_from,
    record.station_to,
    getSourceState(record),
    getSourceDistrict(record),
    getCompanyDisplay(record),
    getProductDisplay(record),
    getCommodityDisplay(record),
    getRakeCmdtDisplay(record),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function mapOptions(map) {
  return [...map.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .map(([value, label]) => ({ value, label, searchText: `${label} ${value}` }));
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

function getSourceState(record) {
  return record.from_state || readRaw(record, "State (Source)", "State Source", "StateSource") || getStationMeta(record.station_from)?.state || "";
}

function getSourceDistrict(record) {
  return record.from_district || readRaw(record, "District (Source)", "District Source", "DistrictSource") || getStationMeta(record.station_from)?.district || "";
}

function getFnr(record) {
  return readRaw(record, "FNR", "FNR No", "FNR Number") || record.fnr || record.odr_number || "";
}

function formatDateTime(date, time) {
  const dateText = String(date || "").trim();
  const timeText = String(time || "").trim();
  if (!dateText) return timeText;
  if (!timeText || dateText.includes(timeText)) return dateText;
  return `${dateText} ${timeText}`;
}

function buildFilterName(filters) {
  const parts = [
    filters.search,
    filters.division !== "All" ? filters.division : "",
    ...filters.states,
    ...filters.districts,
    ...filters.stations,
    ...filters.commodities,
    ...filters.rakeCmdts,
  ].filter(Boolean);
  return parts.slice(0, 4).join(" + ") || "Outward Monitor Filter";
}

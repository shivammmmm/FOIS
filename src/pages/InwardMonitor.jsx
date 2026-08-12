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
import {
  getDemandUnits as getCanonicalDemandUnits,
  getSuppliedUnits as getCanonicalSuppliedUnits,
  getSuppliedTimeText,
  getMaturedDateText,
} from "@/utils/foisLifecycle";
import { formatFoisDate, formatFoisDateTime, formatFoisTime } from "@/utils/foisDateTime";
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
  cnsr: [],
  cnsg: [],
  status: "all",
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
  const [options, setOptions] = useState({ commodities: [], rakeCmdts: [], cnsr: [], cnsg: [] });
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
        const data = await base44.movements.page({
          direction: "Inward",
          page,
          limit: PER_PAGE,
          search: filters.search,
          zone: filters.zone,
          division: filters.division,
          state: filters.states,
          district: filters.districts,
          station: filters.stations,
          commodity: filters.commodities,
          rake: filters.rakeCmdts,
          cnsr: filters.cnsr,
          cnsg: filters.cnsg,
          status: filters.status !== "all" ? filters.status : undefined,
        });
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
      setOptions({ commodities: source.commodity || [], rakeCmdts: source.rake || [], cnsr: source.cnsr || [], cnsg: source.cnsg || [] });
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
      cnsr: normalizeMultiValue(nextFilters.cnsr),
      cnsg: normalizeMultiValue(nextFilters.cnsg),
      status: nextFilters.status || "all",
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
          <MultiSelectFilter label="Consignor (CNSR)" selected={filters.cnsr} onChange={(value) => setFilter("cnsr", value)} options={options.cnsr} placeholder="All Consignors" />
          <MultiSelectFilter label="Consignee (CNSG)" selected={filters.cnsg} onChange={(value) => setFilter("cnsg", value)} options={options.cnsg} placeholder="All Consignees" />

          <select
            value={filters.status || "all"}
            onChange={(event) => setFilter("status", event.target.value)}
            className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:border-primary/50"
          >
            <option value="all">📋 All Status / Stage</option>
            <option value="supplied">🚚 Supplied Data Only</option>
            <option value="matured">🎯 Matured Data Only</option>
            <option value="both">⚡ Supplied & Matured Both</option>
            <option value="pending">⏳ Pending / Unsupplied</option>
          </select>

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
          placeholder="Search Rack ID / Rake Ref, Demand No, station, division, commodity, company..."
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
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-3 text-left">Rack ID / Rake Ref</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  <div>Indent (Demand)</div>
                  <div className="text-[10px] font-normal text-muted-foreground/80">No. | Date | Time</div>
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                  Arrival Stn
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">District</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">State</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">CNSR</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">CMDT (Item Category)</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">RCMDT (Item)</th>
                <th className="whitespace-nowrap px-4 py-3 text-center">Units (Demand)</th>
                <th className="whitespace-nowrap px-4 py-3 text-center">Units (Supplied)</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10">
                  Source Stn
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Supplied</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Matured</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, row) => (
                  <tr key={row} className="border-b border-border/50">
                    {[...Array(13)].map((__, col) => (
                      <td key={col} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRecords.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No inward records.
                  </td>
                </tr>
              ) : (
                pageRecords.map((record) => (
                  <tr key={record.id} onClick={() => setSelectedRecord(record)} className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {getUniqueRakeCodeDisplay(record)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-foreground whitespace-nowrap">
                      {formatIndentDemandCombined(record)}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/5">
                      {formatStationNameAndCode(record.station_to)}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground">{getDestDistrict(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getDestState(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground font-medium">{getCompanyDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground font-semibold">{record.commodity || getProductDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{getRakeCmdtDisplay(record) || "-"}</td>
                    <td className="px-4 py-3 text-center text-xs font-semibold text-foreground">{getIndentedUnits(record)}</td>
                    <td className="px-4 py-3 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">{getSuppliedUnits(record)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground bg-amber-500/5 font-medium">{formatStationNameAndCode(record.station_from)}</td>
                    <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap">{renderSuppliedCell(record)}</td>
                    <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap">{renderMaturedCell(record)}</td>
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

function getFnr(record) {
  return record.odr_number || record.indent_no || record.fnr || "-";
}

function getUniqueRakeCodeDisplay(record) {
  const code = record.unique_rake_code || "";
  const fnr = getFnr(record);
  const stn = record.station_to || record.station_from || "";
  const prd = record.product || record.rake_cmdt || record.rake_commodity_code || record.commodity || "";

  if (code && !code.startsWith("Rake/") && !code.includes("1984")) {
    const parts = code.split("/");
    if (parts.length >= 3) return code;
    if (prd && !/^\d+(\.\d+)?$/.test(prd) && !["POL", "ALL"].includes(prd.toUpperCase())) {
      return `${code}/${prd.toUpperCase()}`;
    }
    return code;
  }

  if (!fnr || fnr === "-") return record.id || "-";
  let base = stn ? `RAKE-${fnr}/${stn.toUpperCase()}` : `ODR-${fnr}`;
  if (prd && !/^\d+(\.\d+)?$/.test(prd) && !["POL", "ALL"].includes(prd.toUpperCase())) {
    base += `/${prd.toUpperCase()}`;
  }
  return base;
}

function getDestDistrict(record) {
  return record.dest_district || record.to_district || record.district_to || "";
}

function getDestState(record) {
  return record.dest_state || record.to_state || record.state_to || "";
}

function getCompanyDisplay(record) {
  return record.company || record.company_code || record.cnsr || "-";
}

function getProductDisplay(record) {
  return record.product || record.product_code || record.commodity || "-";
}

function readRaw(record, ...keys) {
  const raw = record.raw_data || {};
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
    const lowerKey = String(k).toLowerCase();
    for (const rawKey of Object.keys(raw)) {
      if (rawKey.toLowerCase() === lowerKey && raw[rawKey] !== undefined && raw[rawKey] !== null && raw[rawKey] !== "") {
        return raw[rawKey];
      }
    }
  }
  return "";
}

function isNumericCode(val) {
  const s = String(val || "").trim();
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return false;
  const num = Number(s);
  if (num >= 40000 && num <= 60000) return false;
  return true;
}

function formatIndentDemandCombined(record) {
  const fnr = getFnr(record);
  const rawDateStr = record.departure_date || record.indent_date || record.demand_date || readRaw(record, "DATE", "DEMAND DATE", "INDENT DATE", "arrival_date");
  const rawTimeStr = record.indent_time || record.demand_time || readRaw(record, "Time", "indent_time", "TIME", "DEMAND TIME", "INDENT TIME", "time");
  const dateVal = isNumericCode(rawDateStr) ? "" : formatFoisDate(rawDateStr);
  const timeVal = formatFoisTime(rawTimeStr);

  if (!fnr || fnr === "-") return "-";
  if (dateVal && dateVal !== "-") {
    return `${fnr} (${dateVal}${timeVal && timeVal !== "-" ? ` ${timeVal}` : ""})`;
  }
  return fnr;
}

function getIndentedUnits(record) {
  return getCanonicalDemandUnits(record);
}

function getSuppliedUnits(record) {
  return getCanonicalSuppliedUnits(record);
}

function renderSuppliedCell(record) {
  const formatted = getSuppliedTimeText(record);
  if (formatted && formatted !== "-") {
    return <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatted}</span>;
  }
  return <span className="text-muted-foreground">-</span>;
}

function renderMaturedCell(record) {
  const dateVal = getMaturedDateText(record);
  if (dateVal && dateVal !== "-") {
    return <span className="font-medium text-blue-600 dark:text-blue-400">{dateVal}</span>;
  }
  return <span className="text-muted-foreground">-</span>;
}

function buildFilterName(filters) {
  const parts = [];
  if (filters.status && filters.status !== "all") parts.push(`Status:${filters.status}`);
  if (filters.zone?.length) parts.push(`Zone:${filters.zone.join(",")}`);
  if (filters.division?.length) parts.push(`Div:${filters.division.join(",")}`);
  if (filters.stations?.length) parts.push(`Stn:${filters.stations.join(",")}`);
  return parts.join(" | ") || "Custom Filter";
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Save, Search, Train } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import FreightDetailsModal from "@/components/FreightDetailsModal";
import { useAuth } from "@/lib/AuthContext";
import { registerStationMetaFromRecords } from "@/utils/stationMaster";
import { formatFoisDate, formatFoisTime } from "@/utils/foisDateTime";
import {
  clearPersistentFilters,
  hasSavedFilterValues,
  normalizeMultiValue,
  readPersistentFilters,
  writePersistentFilters,
} from "@/utils/persistentFilters";

const PER_PAGE = 25;
const FILTER_SOURCE = "foisReports";
const REPORT_SOURCE = "FOIS Reports";

let reportSessionCache = null;

const SHEET_COLUMNS = [
  "DVSN",
  "STTN FROM",
  "NO.",
  "DATE",
  "TIME",
  "CNSR",
  "CNSG",
  "CMDT",
  "RAKE CMDT",
  "Upload Date",
  "DSTN",
  "INDENTED UNTS",
  "SUPPLIED UNTS",
  "SUPPLIED TIME",
];

const DEFAULT_FILTERS = {
  search: "",
  divisions: [],
  stationsFrom: [],
  commodities: [],
  destinations: [],
};

export default function FreightTracker() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("odr") || "";
  const didLoadPersisted = useRef(false);

  const cachedForUser = reportSessionCache?.userId === user?.id ? reportSessionCache : null;
  const [records, setRecords] = useState(cachedForUser?.records || []);
  const [uploadDates] = useState(new Map());
  const [uploadDateError, setUploadDateError] = useState("");
  const [savedFilters, setSavedFilters] = useState(cachedForUser?.savedFilters || []);
  const [loading, setLoading] = useState(!cachedForUser);
  const [filters, setFilters] = useState(cachedForUser?.filters || { ...DEFAULT_FILTERS, search: initialSearch });
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(cachedForUser?.page || 1);
  const [totalRecords, setTotalRecords] = useState(cachedForUser?.totalRecords || 0);
  const [totalPages, setTotalPages] = useState(cachedForUser?.totalPages || 1);
  const [filterOptions, setFilterOptions] = useState(cachedForUser?.filterOptions || { divisions: [], stationsFrom: [], commodities: [], destinations: [] });
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [exporting, setExporting] = useState(false);
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(filters.search), 350);
    return () => window.clearTimeout(id);
  }, [filters.search]);

  useEffect(() => {
    const query = { page, limit: PER_PAGE, search: debouncedSearch, division: filters.divisions, stationFrom: filters.stationsFrom, commodity: filters.commodities, destination: filters.destinations, unmappedOnly: showUnmappedOnly };
    const queryKey = JSON.stringify(query);
    if (reportSessionCache?.userId === user?.id && reportSessionCache.queryKey === queryKey) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    base44.foisReports.page(query).then((data) => {
      if (!current) return;
      const nextRecords = extractItems(data);
      registerStationMetaFromRecords(nextRecords);
      const options = data.options || {};
      const nextOptions = { divisions: options.division || [], stationsFrom: options.stationFrom || [], commodities: options.commodity || [], destinations: options.destination || [] };
      setRecords(nextRecords);
      setTotalRecords(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setFilterOptions(nextOptions);
      setUploadDateError("");
      reportSessionCache = { userId: user?.id, queryKey, records: nextRecords, totalRecords: data.total || 0, totalPages: data.totalPages || 1, filterOptions: nextOptions, filters, page, savedFilters };
    }).catch((error) => {
      if (current) setUploadDateError(error?.message || "FOIS Reports could not be loaded");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [debouncedSearch, filters.divisions, filters.stationsFrom, filters.commodities, filters.destinations, page, savedFilters, showUnmappedOnly, user?.id]);

  useEffect(() => {
    if (!user?.id || savedFilters.length) return;
    base44.entities.SavedFilter.filter({ user_id: user.id }, "-created_at", 100)
      .then((rows) => setSavedFilters((rows || []).filter((row) => ["FOIS Reports", "Freight Tracker", "Reports"].includes(row.source))))
      .catch((error) => console.error("[FOIS Reports] saved filters failed:", error));
  }, [savedFilters.length, user?.id]);

  useEffect(() => {
    if (didLoadPersisted.current || !user?.id) return;
    didLoadPersisted.current = true;

    const persisted = readPersistentFilters(FILTER_SOURCE, user.id);
    if (persisted) {
      applyFilterState(persisted, { keepUrlSearch: Boolean(initialSearch) });
    }
    if (initialSearch) {
      setFilters((prev) => ({ ...prev, search: initialSearch }));
    }
  }, [initialSearch, user?.id]);

  const sheetRows = useMemo(
    () => records.map((record) => ({ record, row: buildSheetRow(record, uploadDates) })),
    [records, uploadDates]
  );

  const unmappedStations = useMemo(() => {
    const stations = new Map();
    for (const record of records) {
      addUnmappedStation(stations, record.station_from, record.from_station_name, "Source");
      addUnmappedStation(stations, record.station_to, record.to_station_name, "Destination");
    }
    return [...stations.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [records]);
  const filteredRows = sheetRows;
  const visibleRows = sheetRows;
  const hasActiveFilters = hasSavedFilterValues(filters);

  function resetPage() {
    setPage(1);
  }

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
    resetPage();
  }

  function applyFilterState(nextFilters, { keepUrlSearch = false } = {}) {
    setFilters((prev) => ({
      ...DEFAULT_FILTERS,
      search: keepUrlSearch ? prev.search : nextFilters.search || "",
      divisions: normalizeMultiValue(nextFilters.divisions ?? nextFilters.filterDivision),
      stationsFrom: normalizeMultiValue(nextFilters.stationsFrom ?? nextFilters.stations),
      commodities: normalizeMultiValue(
        nextFilters.commodities ?? nextFilters.filterCommodity
      ),
      destinations: normalizeMultiValue(nextFilters.destinations),
    }));
    resetPage();
  }

  async function saveCurrentFilter() {
    if (!user?.id) return;
    writePersistentFilters(FILTER_SOURCE, user.id, filters);

    const saved = await base44.entities.SavedFilter.create({
      user_id: user.id,
      name: buildFilterName(filters),
      source: REPORT_SOURCE,
      filters,
    });
    setSavedFilters((prev) => {
      const next = [saved, ...prev];
      if (reportSessionCache?.userId === user.id) reportSessionCache.savedFilters = next;
      return next;
    });
  }

  function clearFilters() {
    setFilters({ ...DEFAULT_FILTERS });
    if (user?.id) clearPersistentFilters(FILTER_SOURCE, user.id);
    resetPage();
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const exportRows = visibleRows.map(({ row }) => row);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(exportRows, { header: SHEET_COLUMNS }),
        "FOIS Reports"
      );
      XLSX.writeFile(workbook, `FOIS_Reports_${Date.now()}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Train className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">FOIS Reports</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {totalRecords} uploaded FOIS sheet record(s)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveCurrentFilter}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            <Save className="h-3.5 w-3.5" />
            Save Filter
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || visibleRows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting" : "Export Current Page"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <input
          value={filters.search}
          onChange={(event) => setFilter("search", event.target.value)}
          placeholder="Search DVSN, STTN FROM, NO., CNSR, CNSG, CMDT, DSTN..."
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <MultiSelectFilter
          label="DVSN"
          selected={filters.divisions}
          onChange={(value) => setFilter("divisions", value)}
          options={filterOptions.divisions}
          placeholder="All DVSN"
        />
        <MultiSelectFilter
          label="STTN FROM"
          selected={filters.stationsFrom}
          onChange={(value) => setFilter("stationsFrom", value)}
          options={filterOptions.stationsFrom}
          placeholder="All STTN FROM"
        />
        <MultiSelectFilter
          label="CMDT"
          selected={filters.commodities}
          onChange={(value) => setFilter("commodities", value)}
          options={filterOptions.commodities}
          placeholder="All CMDT"
        />
        <MultiSelectFilter
          label="DSTN"
          selected={filters.destinations}
          onChange={(value) => setFilter("destinations", value)}
          options={filterOptions.destinations}
          placeholder="All DSTN"
        />
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

      <div className="text-xs text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">{visibleRows.length}</span>{" "}
        of <span className="font-medium text-foreground">{totalRecords}</span>{" "}
        records
      </div>
      {unmappedStations.length > 0 && (
        <section className="rounded-lg border border-amber-400/40 bg-amber-50 p-3 text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Station Master Missing: {unmappedStations.length}</div>
              <p className="mt-0.5 text-xs text-amber-800">These FOIS station codes were found in records but do not have station-master enrichment.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowUnmappedOnly((value) => !value);
                setPage(1);
              }}
              className="rounded-lg border border-amber-500/50 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100"
            >
              {showUnmappedOnly ? "Show All Records" : "Show Unmapped Records Only"}
            </button>
          </div>
          <div className="mt-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {unmappedStations.map((station) => (
              <span key={station.code} className="rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs" title={station.locations.join(" & ")}>
                {station.name || station.code}
              </span>
            ))}
          </div>
        </section>
      )}
      {uploadDateError && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">FOIS Reports unavailable: {uploadDateError}</div>}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          {loading ? (
            <LoadingTable />
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {totalRecords === 0
                ? "No data yet. Upload a FOIS file to get started."
                : "No records match your filters."}
            </div>
          ) : (
            <table className="w-full min-w-[1380px] table-fixed text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-blue-700 text-white">
                  {SHEET_COLUMNS.map((header) => (
                    <th
                      key={header}
                      className="border border-blue-800 px-2 py-2 text-left font-semibold uppercase tracking-wide"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ record, row }) => (
                  <tr
                    key={record.id}
                    onClick={() => setSelectedRecord(record)}
                    className={`cursor-pointer border-b border-slate-200 transition-colors hover:bg-blue-50/60 ${
                      record.is_duplicate ? "bg-orange-50" : "bg-white"
                    }`}
                  >
                    {SHEET_COLUMNS.map((column) => (
                      <td key={`${record.id}-${column}`} className="border border-slate-300 px-2 py-2 align-top text-slate-800">
                        {dash(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filteredRows.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} - {totalRecords} records
            </span>
            <div className="flex gap-2">
              <PageButton onClick={() => setPage(1)} disabled={page === 1}>
                First
              </PageButton>
              <PageButton
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
              >
                Prev
              </PageButton>
              <PageButton
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page === totalPages}
              >
                Next
              </PageButton>
              <PageButton
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
              >
                Last
              </PageButton>
            </div>
          </div>
        )}
      </div>

      <FreightDetailsModal
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}

function PageButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-border bg-muted px-3 py-1 text-xs text-foreground hover:bg-muted/80 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LoadingTable() {
  return (
    <div className="min-w-[1380px] p-4">
      {[...Array(10)].map((_, row) => (
        <div key={row} className="mb-2 grid grid-cols-12 gap-2">
          {[...Array(12)].map((__, col) => (
            <div key={col} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}

function buildSheetRow(record, uploadDates) {
  const uploadKey = normalizeBatchKey(
    record.upload_batch_id ||
    record.batch_id ||
    record.upload_id ||
    record.raw_data?.upload_batch_id ||
    record.raw_data?.batch_id
  );
  return {
    DVSN: readValue(record, "DVSN", "division"),
    "STTN FROM": readValue(record, "STTN FROM", "station_from"),
    "NO.": readValue(record, "NO.", "indent_no", "FNR", "odr_number"),
    DATE: formatFoisDate(readValue(record, "DATE", "indent_date", "departure_date")),
    TIME: formatFoisTime(readValue(record, "TIME", "indent_time", "Time")),
    CNSR: readValue(record, "CNSR", "cnsr", "company_code", "company"),
    CNSG: readValue(record, "CNSG", "cnsg"),
    CMDT: readValue(record, "CMDT", "Commodity", "commodity_code", "commodity"),
    "RAKE CMDT": readValue(record, "RAKE CMDT", "Rake CMDT", "rake_commodity_code", "rake_cmdt"),
    "Upload Date": formatUploadDate(record.upload_date || uploadDates.get(uploadKey)),
    DSTN: readValue(record, "DSTN", "station_to"),
    "INDENTED UNTS": readValue(record, "INDENTED UNTS", "indented_units"),
    "SUPPLIED UNTS": readValue(record, "SUPPLIED UNTS", "supplied_units", "wagons"),
    "SUPPLIED TIME": formatFoisTime(readValue(record, "SUPPLIED TIME", "supplied_time", "UpdatedTime")),
  };
}

function extractItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.rows)) return response.rows;
  return [];
}

function normalizeBatchKey(value) {
  return String(value || "").trim();
}

function buildUploadDateMap(uploads) {
  const dates = new Map();
  uploads.forEach((upload) => {
    const date = upload.uploaded_at || upload.upload_time || upload.created_date;
    const keys = [upload.batch_id, upload.upload_batch_id, upload.upload_id, upload.id];
    keys.map(normalizeBatchKey).filter(Boolean).forEach((key) => dates.set(key, date));
  });
  return dates;
}

function formatUploadDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readValue(record, ...keys) {
  const raw = record?.raw_data || {};
  const normalizedRaw = Object.entries(raw).reduce((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value =
      raw[key] ??
      record?.[key] ??
      normalizedRaw[normalizeKey(key)];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeKey(key) {
  return String(key || "").trim().toUpperCase();
}

function dash(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function addUnmappedStation(map, stationCode, stationName, location) {
  const code = String(stationCode || "").trim().toUpperCase();
  if (!code || String(stationName || "").trim()) return;
  const current = map.get(code) || { code, name: code, locations: [] };
  if (!current.locations.includes(location)) current.locations.push(location);
  map.set(code, current);
}

function toSortedOptions(values) {
  return [...values]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildFilterName(filters) {
  const parts = [
    filters.search,
    ...filters.divisions,
    ...filters.stationsFrom,
    ...filters.commodities,
    ...filters.destinations,
  ].filter(Boolean);
  return parts.slice(0, 4).join(" + ") || "FOIS Report Filter";
}

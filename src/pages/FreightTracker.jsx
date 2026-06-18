import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, ChevronDown, Train, Save } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  getRakeTypeName,
  getCommodityName,
  getDivisionMeta,
  getDistrictsFromDivisions,
  divisionMatchesDistrict,
} from "@/utils/railwayDictionary";
import { getStationMeta } from "@/utils/stationMaster";
import FreightDetailsModal from "@/components/FreightDetailsModal";
import { useAuth } from "@/lib/AuthContext";

const STATUSES = [
  "All",
  "Pending",
  "In Transit",
  "Arrived",
  "Departed",
  "Delayed",
];
const MOVEMENT_TYPES = ["All", "Inward", "Outward", "Unknown"];
const PER_PAGE = 25;

export default function FreightTracker() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("odr") || "");
  const [filterZone, setFilterZone] = useState("All");
  const [filterState, setFilterState] = useState("All");
  const [filterDistrict, setFilterDistrict] = useState("All");
  const [filterDivision, setFilterDivision] = useState("All");
  const [filterCommodity, setFilterCommodity] = useState("All");
  const [filterRakeCmdt, setFilterRakeCmdt] = useState("All");
  const [filterMovement, setFilterMovement] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await base44.entities.FreightMovement.list(
          "-created_date",
          2000
        );
        setRecords(data);
        if (user?.id) {
          const filters = await base44.entities.SavedFilter.filter({ user_id: user.id }, "-created_at", 100);
          setSavedFilters(filters);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const zones = [
    "All",
    ...new Set(records.map((r) => r.zone).filter(Boolean)).values(),
  ].sort();
  const stationStates = records
    .map((r) => getStationMeta(getPrimaryStationCode(r))?.state)
    .filter(Boolean);
  const allStates = ["All", ...new Set(stationStates)].sort();

  const divisionsInScope = records
    .filter(
      (r) =>
        filterZone === "All" ||
        String(r.zone || "")
          .toUpperCase()
          .trim() === String(filterZone).toUpperCase().trim()
    )
    .filter((r) => {
      if (filterState === "All") return true;
      return getDivisionMeta(r.division)?.state?.includes(filterState);
    })
    .map((r) => r.division)
    .filter(Boolean);

  const divisions = ["All", ...new Set(divisionsInScope).values()].sort();
  const stationDistricts = records
    .map((r) => getStationMeta(getPrimaryStationCode(r))?.district)
    .filter(Boolean);
  const allDistricts = [
    "All",
    ...new Set([
      ...stationDistricts,
      ...getDistrictsFromDivisions([...new Set(divisionsInScope)]),
    ]),
  ].sort();
  const commodities = [
    "All",
    ...new Set(records.map((r) => r.commodity).filter(Boolean)),
  ].sort();
  const rakeCmdts = [
    "All",
    ...new Set(records.map((r) => r.rake_type).filter(Boolean)),
  ].sort();

  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      String(r.odr_number || "")
        .toLowerCase()
        .includes(q) ||
      r.station_from?.toLowerCase().includes(q) ||
      r.station_to?.toLowerCase().includes(q) ||
      r.zone?.toLowerCase().includes(q) ||
      r.division?.toLowerCase().includes(q) ||
      r.commodity?.toLowerCase().includes(q) ||
      getCommodityName(r.commodity)?.toLowerCase().includes(q) ||
      r.rake_type?.toLowerCase().includes(q);
    const matchZone =
      filterZone === "All" ||
      String(r.zone || "")
        .toUpperCase()
        .trim() === String(filterZone).toUpperCase().trim();
    const stationMeta = getStationMeta(getPrimaryStationCode(r));
    const divisionMeta = getDivisionMeta(r.division);
    const matchState =
      filterState === "All" ||
      stationMeta?.state === filterState ||
      divisionMeta?.state?.includes(filterState);
    const matchDistrict =
      filterDistrict === "All" ||
      stationMeta?.district === filterDistrict ||
      divisionMatchesDistrict(r.division, filterDistrict);
    const matchDiv = filterDivision === "All" || r.division === filterDivision;
    const matchComm =
      filterCommodity === "All" || r.commodity === filterCommodity;
    const matchRakeCmdt =
      filterRakeCmdt === "All" || r.rake_type === filterRakeCmdt;
    const matchMov =
      filterMovement === "All" || r.movement_type === filterMovement;
    const matchStatus = filterStatus === "All" || r.status === filterStatus;
    return (
      matchSearch &&
      matchZone &&
      matchState &&
      matchDistrict &&
      matchDiv &&
      matchComm &&
      matchRakeCmdt &&
      matchMov &&
      matchStatus
    );
  });

  const inwardRecords = filtered.filter((r) => r.movement_type === "Inward");
  const outwardRecords = filtered.filter((r) => r.movement_type === "Outward");
  const visibleInward = inwardRecords.slice(
    (page - 1) * PER_PAGE,
    page * PER_PAGE
  );
  const visibleOutward = outwardRecords.slice(
    (page - 1) * PER_PAGE,
    page * PER_PAGE
  );
  const totalPages = Math.max(
    1,
    Math.ceil(inwardRecords.length / PER_PAGE),
    Math.ceil(outwardRecords.length / PER_PAGE)
  );
  const missingStationCodes = getMissingStationCodes(filtered);

  const resetPage = () => setPage(1);

  const currentFilters = {
    search,
    filterZone,
    filterState,
    filterDistrict,
    filterDivision,
    filterCommodity,
    filterRakeCmdt,
    filterMovement,
    filterStatus,
  };

  const saveCurrentFilter = async () => {
    if (!user?.id) return;
    const meaningful = Object.entries(currentFilters)
      .filter(([key, value]) => value && value !== "All" && !(key === "search" && !value))
      .map(([, value]) => value)
      .join(" + ");
    const name = meaningful || "All Freight";
    const saved = await base44.entities.SavedFilter.create({
      user_id: user.id,
      name,
      source: "Freight Tracker",
      filters: currentFilters,
    });
    setSavedFilters((prev) => [saved, ...prev]);
  };

  const applySavedFilter = (filterId) => {
    const saved = savedFilters.find((f) => f.id === filterId);
    if (!saved?.filters) return;
    setSearch(saved.filters.search || "");
    setFilterZone(saved.filters.filterZone || "All");
    setFilterState(saved.filters.filterState || "All");
    setFilterDistrict(saved.filters.filterDistrict || "All");
    setFilterDivision(saved.filters.filterDivision || "All");
    setFilterCommodity(saved.filters.filterCommodity || "All");
    setFilterRakeCmdt(saved.filters.filterRakeCmdt || "All");
    setFilterMovement(saved.filters.filterMovement || "All");
    setFilterStatus(saved.filters.filterStatus || "All");
    resetPage();
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Train className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Freight Tracker</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {records.length} total records - inward and outward shown separately
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          placeholder="Search Sr.No, station, zone, commodity, rake type..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          value={filterZone}
          onChange={(v) => {
            setFilterZone(v);
            setFilterState("All");
            setFilterDistrict("All");
            setFilterDivision("All");
            resetPage();
          }}
          options={zones}
          label="Zone"
        />
        <FilterSelect
          value={filterState}
          onChange={(v) => {
            setFilterState(v);
            setFilterDistrict("All");
            setFilterDivision("All");
            resetPage();
          }}
          options={allStates}
          label="State"
        />
        <FilterSelect
          value={filterDistrict}
          onChange={(v) => {
            setFilterDistrict(v);
            setFilterDivision("All");
            resetPage();
          }}
          options={allDistricts}
          label="District"
        />
        <FilterSelect
          value={filterDivision}
          onChange={(v) => {
            setFilterDivision(v);
            resetPage();
          }}
          options={divisions}
          label="Division"
        />
        <FilterSelect
          value={filterCommodity}
          onChange={(v) => {
            setFilterCommodity(v);
            resetPage();
          }}
          options={commodities}
          label="Commodity"
        />
        <FilterSelect
          value={filterRakeCmdt}
          onChange={(v) => {
            setFilterRakeCmdt(v);
            resetPage();
          }}
          options={rakeCmdts}
          label="Rake CMDT"
        />
        <FilterSelect
          value={filterMovement}
          onChange={(v) => {
            setFilterMovement(v);
            resetPage();
          }}
          options={MOVEMENT_TYPES}
          label="Movement"
        />
        <FilterSelect
          value={filterStatus}
          onChange={(v) => {
            setFilterStatus(v);
            resetPage();
          }}
          options={STATUSES}
          label="Status"
        />
        {(filterZone !== "All" ||
          filterState !== "All" ||
          filterDistrict !== "All" ||
          filterDivision !== "All" ||
          filterCommodity !== "All" ||
          filterRakeCmdt !== "All" ||
          filterMovement !== "All" ||
          filterStatus !== "All" ||
          search) && (
          <button
            onClick={() => {
              setFilterZone("All");
              setFilterState("All");
              setFilterDistrict("All");
              setFilterDivision("All");
              setFilterCommodity("All");
              setFilterRakeCmdt("All");
              setFilterMovement("All");
              setFilterStatus("All");
              setSearch("");
              resetPage();
            }}
            className="px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors"
          >
            Clear Filters
          </button>
        )}
        <button
          onClick={saveCurrentFilter}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs text-primary hover:bg-primary/10 rounded-lg border border-primary/30 transition-colors"
        >
          <Save className="h-3.5 w-3.5" />
          Save Filter
        </button>
        {savedFilters.length > 0 && (
          <FilterSelect
            value="All"
            onChange={applySavedFilter}
            options={["All", ...savedFilters.map((f) => f.id)]}
            label="Saved Filter"
            formatOption={(value) => value === "All" ? "Apply Saved Filter" : savedFilters.find((f) => f.id === value)?.name || value}
          />
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">
          {visibleInward.length + visibleOutward.length}
        </span>{" "}
        of{" "}
        <span className="font-medium text-foreground">{filtered.length}</span>{" "}
        records
        <span className="ml-2 text-emerald-600">
          {inwardRecords.length} inward
        </span>
        <span className="ml-2 text-blue-600">
          {outwardRecords.length} outward
        </span>
        {filtered.length !== records.length &&
          ` (filtered from ${records.length})`}
      </div>

      {missingStationCodes.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Missing station/siding metadata:{" "}
          <span className="font-mono font-semibold">
            {missingStationCodes.join(", ")}
          </span>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {loading ? (
            <LoadingTable />
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted-foreground text-sm">
              {records.length === 0
                ? "No data yet. Upload an ODR file to get started."
                : "No records match your filters."}
            </div>
          ) : (
            <div className="min-w-[1120px]">
              <MovementTable
                title="Rake Inward"
                records={visibleInward}
                type="Inward"
                onSelect={setSelectedRecord}
              />
              <MovementTable
                title="Rake Outward"
                records={visibleOutward}
                type="Outward"
                onSelect={setSelectedRecord}
              />
            </div>
          )}
        </div>

        {filtered.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} - {filtered.length} records
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >
                First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >
                Next
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
      <FreightDetailsModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

function MovementTable({ title, records, type, onSelect }) {
  return (
    <table className="w-full table-fixed text-xs border-collapse">
      <thead>
        <tr>
          {[
            "Movement",
            "Source Station",
            "Destination Station",
            "State",
            "District",
            "Commodity (CMDT)",
            "Rake CMDT",
            "Wagons",
            "Departure Date",
            "Arrival Date",
          ].map((h, index) => (
            <th
              key={`${type}-${h}`}
              className={`border border-slate-300 bg-slate-50 px-2 py-2 text-center align-bottom font-semibold text-slate-900 ${
                index === 0 ? "w-24" : ""
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
        <tr>
          <th className="border border-slate-300 bg-white px-2 py-2 text-center font-semibold text-slate-900">
            {title.replace("Rake ", "")}
          </th>
          <th className="border border-slate-300 bg-white px-2 py-2 text-center font-normal text-slate-700">
            Station Name (Station Code)
          </th>
          <th className="border border-slate-300 bg-white px-2 py-2 text-center font-normal text-slate-700">
            Station Name (Station Code)
          </th>
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
          <th className="border border-slate-300 bg-white px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {records.length === 0 ? (
          <tr>
            <td
              colSpan={10}
              className="border border-slate-300 px-4 py-8 text-center text-muted-foreground"
            >
              No {type.toLowerCase()} records.
            </td>
          </tr>
        ) : (
          records.map((record) => (
            <MovementRow key={record.id} record={record} type={type} onSelect={onSelect} />
          ))
        )}
      </tbody>
    </table>
  );
}

function MovementRow({ record, type, onSelect }) {
  const divisionMeta = getDivisionMeta(record.division);

  // Prefer DB-enriched full forms when available
  const fromName = record.from_station_name || record.from_station_full_name;
  const toName = record.to_station_name || record.to_station_full_name;

  const primaryDistrict =
    type === "Inward" ? record.to_district : record.from_district;
  const primaryState = type === "Inward" ? record.to_state : record.from_state;
  const primaryDivision =
    type === "Inward" ? record.to_division : record.from_division;
  const primaryZone = type === "Inward" ? record.to_zone : record.from_zone;

  return (
    <tr
      onClick={() => onSelect?.(record)}
      className={`cursor-pointer hover:bg-blue-50/60 ${
        record.is_duplicate ? "bg-orange-50" : "bg-white"
      }`}
    >
      <GridCell
        value={record.movement_type || type}
        strong
        duplicate={record.is_duplicate}
      />
      <StationCell code={record.station_from} nameOverride={fromName} />
      <StationCell code={record.station_to} nameOverride={toName} />
      <GridCell
        value={
          readRaw(record, "State", "StateTo", "StateSource") ||
          primaryState ||
          divisionMeta?.state
        }
      />
      <GridCell
        value={
          readRaw(record, "District", "Dist", "DistrictTo", "DistrictSource") ||
          primaryDistrict ||
          divisionMeta?.district
        }
      />
      <GridCell
        value={
          readRaw(record, "Product") ||
          getCommodityName(record.commodity) ||
          record.commodity
        }
      />
      <GridCell value={getRakeTypeName(record.rake_type) || record.rake_type} />
      <GridCell value={record.wagons} align="center" />
      <GridCell
        value={formatDateTime(record.departure_date, record.raw_data?.Time)}
      />
      <GridCell
        value={formatDateTime(
          record.arrival_date,
          record.raw_data?.UpdatedTime
        )}
      />
    </tr>
  );
}

function StationCell({ code, nameOverride }) {
  const meta = getStationMeta(code);
  const label = nameOverride || meta?.name || dash(code);

  return (
    <td className="border border-slate-300 px-2 py-2 align-top">
      <div className="font-medium text-slate-900">{label}</div>
      {code && (
        <div className="mt-0.5 font-mono text-[10px] text-slate-500">{code}</div>
      )}
    </td>
  );
}


function GridCell({
  value,
  strong = false,
  duplicate = false,
  align = "left",
}) {
  return (
    <td
      className={`border border-slate-300 px-2 py-2 align-top text-${align} ${
        strong ? "font-semibold text-primary" : "text-slate-800"
      }`}
    >
      {dash(value)}
      {duplicate && (
        <span className="ml-1 text-[10px] font-semibold text-orange-500">
          DUP
        </span>
      )}
    </td>
  );
}

function LoadingTable() {
  return (
    <div className="min-w-[1120px] p-4">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="mb-2 grid grid-cols-12 gap-2">
          {[...Array(12)].map((__, j) => (
            <div key={j} className="h-8 rounded bg-muted animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

function readRaw(record, ...keys) {
  for (const key of keys) {
    const value = record?.raw_data?.[key] ?? record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return "";
}

function getPrimaryStationCode(record) {
  if (record?.movement_type === "Outward") return record.station_from;
  return record?.station_to || record?.station_from;
}

function getMissingStationCodes(records) {
  const codes = new Set();
  records.forEach((record) => {
    [record.station_from, record.station_to].forEach((code) => {
      if (!code) return;
      const meta = getStationMeta(code);
      if (!meta?.district || !meta?.state)
        codes.add(String(code).toUpperCase().trim());
    });
  });
  return [...codes].sort().slice(0, 30);
}

function formatDateTime(date, time) {
  if (!date && !time) return "";
  return [date, time].filter(Boolean).join(" ");
}

function dash(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function FilterSelect({ value, onChange, options, label, formatOption }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 pr-8 outline-none cursor-pointer hover:border-primary/50 transition-colors"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {formatOption ? formatOption(o) : o === "All" ? `All ${label}s` : o}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

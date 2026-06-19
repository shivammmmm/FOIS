import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowDownToLine, ChevronDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getCommodityColor, getStationName, getDivisionName, getCommodityName, getRakeTypeName } from "@/utils/railwayDictionary";
import { getStationMeta } from "@/utils/stationMaster";
import { isWagonType } from "@/utils/freightRecordFilters";
import StatusBadge from "@/components/StatusBadge";
import FreightDetailsModal from "@/components/FreightDetailsModal";

const PER_PAGE = 25;

export default function InwardMonitor() {
  const [allRecords, setAllRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDivision, setFilterDivision] = useState("All");
  const [selectedStations, setSelectedStations] = useState([]);
  const [filterState, setFilterState] = useState("All");
  const [filterDistrict, setFilterDistrict] = useState("All");
  const [filterComm, setFilterComm] = useState("All");
  const [filterRakeCmdt, setFilterRakeCmdt] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Use same data source as FreightTracker — load all records, then filter by movement_type
        const data = await base44.entities.FreightMovement.list("-created_date", 2000);
        const inwardOnly = (data || []).filter((r) => r.movement_type === "Inward");
        setAllRecords(inwardOnly);
        console.log("[InwardMonitor] loaded:", inwardOnly.length, "inward records out of", (data || []).length, "total");
      } catch (e) {
        console.error("[InwardMonitor] load failed:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const getDestinationStationMeta = (record) => getStationMeta(record?.station_to);

  const divisions = ["All", ...new Set(allRecords.map((r) => r.division).filter(Boolean))].sort();

  const stationFilteredByDiv = filterDivision === "All" ? allRecords : allRecords.filter((r) => r.division === filterDivision);
  const stations = ["All", ...new Set(stationFilteredByDiv.map((r) => r.station_to).filter(Boolean)).values()].sort();

  const isWagonClassLike = (v) => {
    const s = String(v ?? "").trim().toUpperCase();
    if (!s) return false;
    return /^[A-Z]{3,5}[A-Z]?$/.test(s);
  };

  const commodities = ["All", ...new Set(allRecords.map(getCommVal).filter(Boolean))].sort();

  const rakeSourceRecords = filterComm === "All"
    ? allRecords
    : allRecords.filter((r) => getCommVal(r) === filterComm);

  const rakeCmdts = [
    "All",
    ...new Set(rakeSourceRecords.map(getRakeCmdtVal).filter(Boolean)),
  ].sort();

  const stateOptions = [...new Set(stationFilteredByDiv.map((r) => getDestinationStationMeta(r)?.state).filter(Boolean))].sort();
  const districtOptions = [
    ...new Set(
      stationFilteredByDiv
        .filter((r) => filterState === "All" || getDestinationStationMeta(r)?.state === filterState)
        .map((r) => getDestinationStationMeta(r)?.district)
        .filter(Boolean)
    ),
  ].sort();

  const filtered = allRecords.filter((r) => {
    const meta = getDestinationStationMeta(r);

    const matchDiv = filterDivision === "All" || r.division === filterDivision;
    const matchState = filterState === "All" || meta?.state === filterState;
    const matchDistrict = filterDistrict === "All" || meta?.district === filterDistrict;
    const matchStation = selectedStations.length === 0 || selectedStations.includes(r.station_to);

    const matchDate = (() => {
      const d = r.arrival_date;
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    })();
    const matchDates = (!fromDate && !toDate) || matchDate;

    const matchComm = filterComm === "All" || getCommVal(r) === filterComm;
    const matchRakeCmdt = filterRakeCmdt === "All" || getRakeCmdtVal(r) === filterRakeCmdt;

    return matchDiv && matchState && matchDistrict && matchStation && matchDates && matchComm && matchRakeCmdt;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRecords = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const resetPage = () => setPage(1);

  const commMap = {};
  filtered.forEach((r) => { const c = getCommVal(r) || "Unknown"; commMap[c] = (commMap[c] || 0) + 1; });
  const commData = Object.entries(commMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const divMap = {};
  filtered.forEach((r) => { const d = r.division || "Unknown"; divMap[d] = (divMap[d] || 0) + 1; });
  const divData = Object.entries(divMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const pending = filtered.filter((r) => r.status === "Pending").length;
  const arrived = filtered.filter((r) => r.status === "Arrived").length;
  const delayed = filtered.filter((r) => r.status === "Delayed").length;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
            <h1 className="text-2xl font-bold text-foreground">Inward Monitor</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Freight arriving at stations, plants &amp; sidings</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filterDivision}
            onChange={(e) => {
              setFilterDivision(e.target.value);
              setSelectedStations([]);
              setFilterState("All");
              setFilterDistrict("All");
              resetPage();
            }}
            className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer"
          >
            {divisions.map((d) => (
              <option key={d} value={d}>{d === "All" ? "All Divisions" : `${getDivisionName(d)} (${d})`}</option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">From Date</label>
              <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); resetPage(); }} className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer" />
            </div>

            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">To Date</label>
              <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); resetPage(); }} className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer" />
            </div>

            <select
              value={filterState}
              onChange={(e) => {
                setFilterState(e.target.value);
                setFilterDistrict("All");
                setSelectedStations([]);
                resetPage();
              }}
              className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer"
            >
              <option value="All">All States</option>
              {stateOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={filterDistrict}
              onChange={(e) => {
                setFilterDistrict(e.target.value);
                setSelectedStations([]);
                resetPage();
              }}
              className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer"
            >
              <option value="All">All Districts</option>
              {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            <MultiStationSelect label="Select Stations" stations={stations} selected={selectedStations} onChange={(v) => { setSelectedStations(v); resetPage(); }} />
          </div>

          <select value={filterComm} onChange={(e) => { setFilterComm(e.target.value); setFilterRakeCmdt("All"); resetPage(); }} className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer">
            <option value="All">All Commodities</option>
            {commodities.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={filterRakeCmdt} onChange={(e) => { setFilterRakeCmdt(e.target.value); resetPage(); }} className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer">
            <option value="All">All Rake CMDT</option>
            {rakeCmdts.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {(filterDivision !== "All" || filterState !== "All" || filterDistrict !== "All" || selectedStations.length > 0 || filterRakeCmdt !== "All" || filterComm !== "All" || fromDate || toDate) && (
            <button
              onClick={() => {
                setFilterDivision("All");
                setSelectedStations([]);
                setFilterState("All");
                setFilterDistrict("All");
                setFilterComm("All");
                setFilterRakeCmdt("All");
                setFromDate("");
                setToDate("");
                resetPage();
              }}
              className="px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors cursor-pointer"
            >Clear Filters</button>
          )}
        </div>
      </div>

      {selectedStations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 p-2.5 rounded-lg border border-border">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">Active Stations:</span>
          {selectedStations.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
              {getStationName(s)} ({s})
              <button onClick={() => setSelectedStations(selectedStations.filter((x) => x !== s))} className="hover:text-destructive font-bold ml-0.5">&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Inward", value: filtered.length, color: "text-emerald-400" },
          { label: "Arriving / Pending", value: pending, color: "text-amber-400" },
          { label: "Arrived", value: arrived, color: "text-emerald-400" },
          { label: "Delayed", value: delayed, color: "text-red-400" },
        ].map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4">
            <div className={`text-3xl font-bold ${c.color}`}>{loading ? "—" : c.value}</div>
            <div className="text-sm text-muted-foreground mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Inward by Commodity</h3>
          {commData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={commData} layout="vertical" barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {commData.map((entry, i) => <Cell key={i} fill={getCommodityColor(entry.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Inward by Division</h3>
          {divData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={divData} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="count" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Inward Records</h3>
          <span className="text-xs text-muted-foreground">
            {filtered.length} records{filtered.length !== allRecords.length && ` (filtered from ${allRecords.length})`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["ODR No.", "Division", "From Station", "To Station (Arrival)", "Commodity", "Rake CMDT", "Rake Type", "Wagons", "Arrival Date", "Status"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(10)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                </tr>
              )) : pageRecords.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">No inward records.</td></tr>
              ) : pageRecords.map((r) => (
                <tr key={r.id} onClick={() => setSelectedRecord(r)} className="cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-primary font-medium">{r.odr_number}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-foreground">{getDivisionName(r.division)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.division || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">{getStationName(r.station_from)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.station_from || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-emerald-700">{getStationName(r.station_to)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.station_to || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground text-xs">{getCommVal(r) || "—"}</td>
                  <td className="px-4 py-3 text-foreground text-xs">{getRakeCmdtVal(r) || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{getRakeTypeName(getWagonTypeVal(r)) || getWagonTypeVal(r) || "—"}</td>
                  <td className="px-4 py-3 text-center text-foreground text-xs">{r.wagons || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.arrival_date || "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination — same style as FreightTracker */}
        {!loading && filtered.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} &mdash; {filtered.length} records
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >First</button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >Prev</button>

              {/* Page number buttons (show up to 5 around current page) */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === "..." ? (
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item)}
                      className={`px-3 py-1 text-xs rounded border ${page === item ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-muted/80 text-foreground border-border"}`}
                    >{item}</button>
                  )
                )}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >Next</button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-40 text-foreground border border-border"
              >Last</button>
            </div>
          </div>
        )}
      </div>
      <FreightDetailsModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

function EmptyState() { return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data available</div>; }

function readRaw(record, ...keys) {
  for (const key of keys) {
    const value = record?.raw_data?.[key] ?? record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return "";
}

function getCommVal(record) {
  return readRaw(record, "Product") || getCommodityName(record.commodity || record.commodity_code) || record.commodity || record.commodity_code || "";
}

function getRakeCmdtVal(record) {
  const code = record.rake_cmdt || record.rake_commodity_code || "";
  if (code && !isWagonType(code)) return code;
  const legacyCode = record.rake_type || "";
  if (legacyCode && !isWagonType(legacyCode)) return legacyCode;
  return "";
}

function getWagonTypeVal(record) {
  const code = record.rake_type || "";
  if (code && isWagonType(code)) return code;
  return "";
}

function MultiStationSelect({ label, stations, selected, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) { if (containerRef.current && !containerRef.current.contains(event.target)) setIsOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredStations = stations.filter(s => s === "All" || s.toLowerCase().includes(search.toLowerCase()) || getStationName(s).toLowerCase().includes(search.toLowerCase()));
  const toggleStation = (station) => {
    if (station === "All") { onChange([]); return; }
    if (selected.includes(station)) onChange(selected.filter((x) => x !== station));
    else onChange([...selected, station]);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setIsOpen(!isOpen)} className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 pr-8 outline-none w-48 text-left flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors">
        <span className="truncate">{selected.length === 0 ? label : `${selected.length} Station(s)`}</span>
        <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </button>
      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl p-3 space-y-2">
          <input type="text" placeholder="Search stations..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-background border border-border text-foreground text-xs rounded px-2 py-1.5 outline-none focus:border-primary" />
          <div className="flex justify-between text-[10px] text-primary font-bold px-1 pb-1 border-b border-border/40">
            <button type="button" onClick={() => onChange([])} className="hover:underline cursor-pointer">Clear All</button>
            <button type="button" onClick={() => onChange(stations.filter((s) => s !== "All"))} className="hover:underline cursor-pointer">Select All</button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredStations.map((s) => {
              if (s === "All") return null;
              return (
                <label key={s} className="flex items-center gap-2 px-1.5 py-1 hover:bg-muted/50 rounded cursor-pointer text-xs select-none">
                  <input type="checkbox" checked={selected.includes(s)} onChange={() => toggleStation(s)} className="rounded text-primary focus:ring-0 accent-primary cursor-pointer w-3.5 h-3.5" />
                  <span className="truncate text-foreground">{getStationName(s)} ({s})</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

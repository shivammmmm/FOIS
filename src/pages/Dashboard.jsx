import { useEffect, useState, useMemo } from "react";
import { apiClient } from "@/api/apiClient";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  Filter,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { getCommodityColor, getCommodityName } from "@/utils/railwayDictionary";
import { useAuth } from "@/lib/AuthContext";

const COMMODITY_MAP = {
  COAL: ["COAL", "COKE"],
  CEMENT: ["CEMENT", "CEMT", "CLINKER", "CLKR"],
  FERTILIZER: ["UREA", "DAP", "NPK", "FERT", "FERTILIZER"],
  STEEL: ["STEEL", "STEE", "BILLETS", "PIGIRON"],
  GRAIN: ["WHEAT", "RICE", "MAIZE", "FOODGRAIN", "SUGAR", "SUGR"],
};

export default function Dashboard() {
  const { user } = useAuth();
  const [movements, setMovements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);

  // --- Filter Controls States ---
  const [filterZone, setFilterZone] = useState("All");
  const [filterDivision, setFilterDivision] = useState("All");
  const [filterState, setFilterState] = useState("All");
  const [filterDistrict, setFilterDistrict] = useState("All");
  const [filterStation, setFilterStation] = useState("All");
  const [filterCommodityGroup, setFilterCommodityGroup] = useState("All");
  const [filterCommodity, setFilterCommodity] = useState("All");
  const [filterRakeCommodity, setFilterRakeCommodity] = useState("All");
  const [filterMovementType, setFilterMovementType] = useState("All");

  const [filterDateRange, setFilterDateRange] = useState("30");
  const [customFromDate, setCustomFromDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [customToDate, setCustomToDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const displayedCommodities = useMemo(() => {
    if (filterCommodityGroup === "All") {
      return [
        "UREA", "DAP", "NPK", "FREDT", "IMDT",
        "COAL", "COKE",
        "CEMENT", "CEMT", "CLINKER", "CLKR",
        "STEEL", "STEE", "BILLETS", "PIGIRON",
        "WHEAT", "RICE", "MAIZE", "FOODGRAIN", "SUGAR", "SUGR"
      ];
    }
    return COMMODITY_MAP[filterCommodityGroup] || [];
  }, [filterCommodityGroup]);

  // --- Dynamic Pools for Master Data Cascades ---
  const [statesPool, setStatesPool] = useState([]);
  const [districtsPool, setDistrictsPool] = useState([]);
  const [stationsPool, setStationsPool] = useState([]);

  // 🚀 FIX: Dropdowns loading with vanilla fetch to avoid 403 Forbidden role errors
  useEffect(() => {
    const loadMasters = async () => {
      try {
        const token = localStorage.getItem("token") || "";
        const stRes = await fetch("/api/masters/states", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        
        // Agar response ok hai toh data.items nikalenge, nahi toh khali array []
        const stData = stRes.ok ? await stRes.json() : null;
        const stList = stData?.items || (Array.isArray(stData) ? stData : []);
        
        const stnData = await apiClient.stationMaster.list({ limit: 1000 });
        
        setStatesPool(stList);
        setStationsPool(stnData?.items || []);
      } catch (e) {
        console.error("Failed to load dashboard dropdown selectors reference:", e);
      }
    };
    loadMasters();
  }, []);
  
  // 🚀 FIX: Cascading districts hitting the authenticated master endpoints smoothly
  useEffect(() => {
    if (filterState === "All") {
      setDistrictsPool([]);
      setFilterDistrict("All");
      return;
    }
    const fetchDistricts = async () => {
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch(`/api/masters/districts?state_code=${filterState}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = res.ok ? await res.json() : [];
        setDistrictsPool(data);
        setFilterDistrict("All"); 
      } catch (err) {
        console.error(err);
      }
    };
    fetchDistricts();
  }, [filterState]);

  // Centralized functional data payload refresh routine
  const handleApplyFilters = async () => {
    setFiltering(true);
    try {
      const queryPayload = {
        entityType: "movement",
        dateRange: filterDateRange === "custom"
          ? { preset: "custom", from: customFromDate, to: customToDate }
          : { preset: filterDateRange },
        filters: {},
        pagination: { limit: 500, offset: 0 },
      };

      if (filterZone !== "All") queryPayload.filters.zone = filterZone;
      if (filterDivision !== "All") queryPayload.filters.division = filterDivision;
      if (filterState !== "All") queryPayload.filters.state = filterState;
      if (filterDistrict !== "All") queryPayload.filters.district = filterDistrict;
      if (filterStation !== "All") queryPayload.filters.station = filterStation;
      if (filterCommodityGroup !== "All") queryPayload.filters.commodityGroup = filterCommodityGroup;
      if (filterCommodity !== "All") queryPayload.filters.commodity = filterCommodity;
      if (filterRakeCommodity !== "All") queryPayload.filters.rakeCommodity = filterRakeCommodity;
      if (filterMovementType !== "All") queryPayload.filters.movementType = filterMovementType;

      const res = await apiClient.dashboard.filter(queryPayload);
      setMovements(res?.items || []);
    } catch (e) {
      console.error("Operational filter payload propagation failed:", e);
    } finally {
      setFiltering(false);
    }
  };

  useEffect(() => {
    const initialLoad = async () => {
      try {
        const notifs = await apiClient.entities.RailNotification.list("-created_date", 20);
        setNotifications(notifs || []);
        await handleApplyFilters();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      handleApplyFilters();
    }
  }, [
    filterZone,
    filterDivision,
    filterState,
    filterDistrict,
    filterStation,
    filterCommodityGroup,
    filterCommodity,
    filterRakeCommodity,
    filterMovementType,
    filterDateRange,
    customFromDate,
    customToDate,
  ]);

  const inwardToday = movements.filter((m) => m.movement_type === "Inward");
  const outwardToday = movements.filter((m) => m.movement_type === "Outward");
  const duplicates = movements.filter((m) => !!m.is_duplicate);

  const divisionData = useMemo(() => {
    const divisionMap = {};
    movements.forEach((m) => {
      if (!m.division) return;
      divisionMap[m.division] = (divisionMap[m.division] || 0) + 1;
    });
    return Object.entries(divisionMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [movements]);

  const pieData = useMemo(() => {
    const inwardCommodities = {};
    inwardToday.forEach((m) => {
      const c = getCommodityName(m.commodity || "Unknown");
      inwardCommodities[c] = (inwardCommodities[c] || 0) + 1;
    });
    return Object.entries(inwardCommodities)
      .map(([name, value]) => ({ name, value }))
      .slice(0, 6);
  }, [inwardToday]);

  const outwardCommodities = useMemo(() => {
    const outwardMap = {};
    outwardToday.forEach((m) => {
      const c = getCommodityName(m.commodity || "Unknown");
      outwardMap[c] = (outwardMap[c] || 0) + 1;
    });
    return outwardMap;
  }, [outwardToday]);

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header View */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Operations Intelligence Center
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time FOIS freight monitor & system tracking analytics
          </p>
        </div>
        <div className="text-sm font-semibold text-muted-foreground bg-muted border border-border px-4 py-2 rounded-xl self-start md:self-auto">
          📅{" "}
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>

      {/* --- Upgraded Professional Two-Tier Filter Grid Structure --- */}
      <div className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border/60">
          <Filter className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Operational Parameter Scope Filters
          </h2>
        </div>

        {/* Row 1: Territorial Infrastructure Hierarchy Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="flex flex-col space-y-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Zone
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterZone}
              onChange={(e) => setFilterZone(e.target.value)}
            >
              <option value="All">All Zones</option>
              {["CR", "WR", "NR", "ER", "SR", "SCR", "SECR", "ECR", "SWR"].map(
                (z) => (
                  <option key={z} value={z}>
                    {z} Zone
                  </option>
                )
              )}
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Division
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterDivision}
              onChange={(e) => setFilterDivision(e.target.value)}
            >
              <option value="All">All Divisions</option>
              {["BPL", "JBP", "KOTA", "BCT", "BRC", "RTM", "ADI"].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              State Boundary
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
            >
              <option value="All">All States Pool</option>
              {statesPool.map((st) => (
                <option key={st.id || st.code} value={st.code}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              District Area
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              value={filterDistrict}
              onChange={(e) => setFilterDistrict(e.target.value)}
              disabled={filterState === "All"}
            >
              <option value="All">
                {filterState === "All"
                  ? "-- Select state first --"
                  : "All Districts"}
              </option>
              {districtsPool.map((ds) => (
                <option key={ds.id || ds.code} value={ds.name}>
                  {ds.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Siding Station
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterStation}
              onChange={(e) => setFilterStation(e.target.value)}
            >
              <option value="All">All Siding Stations</option>
              {stationsPool.map((stn) => (
                <option
                  key={stn.id || stn.station_code}
                  value={stn.station_code}
                >
                  {stn.station_code} - {stn.station_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Commodity Classifications & Multi-Tier Execution Track */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-12 gap-3 items-end">
          <div className="flex flex-col space-y-1 lg:col-span-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Commodity Group
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterCommodityGroup}
              onChange={(e) => {
                setFilterCommodityGroup(e.target.value);
                setFilterCommodity("All");
              }}
            >
              <option value="All">All Groups</option>
              {["COAL", "CEMENT", "FERTILIZER", "STEEL", "GRAIN"].map((cg) => (
                <option key={cg} value={cg}>
                  {cg}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1 lg:col-span-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Specific Commodity
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterCommodity}
              onChange={(e) => setFilterCommodity(e.target.value)}
            >
              <option value="All">All Commodities</option>
              {displayedCommodities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1 lg:col-span-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Rake Profile
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer"
              value={filterRakeCommodity}
              onChange={(e) => setFilterRakeCommodity(e.target.value)}
            >
              <option value="All">All Rake Classes</option>
              {["BCNHL", "BOXNHL", "BTPN"].map((rk) => (
                <option key={rk} value={rk}>
                  {rk}
                </option>
              ))}
            </select>
          </div>

          {/* 🚀 PRO FIX: Clean isolated div element for Timeline dropdown */}
          <div className="flex flex-col space-y-1 lg:col-span-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Timeline Window
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer w-full"
              value={filterDateRange}
              onChange={(e) => setFilterDateRange(e.target.value)}
            >
              <option value="today">Today (Live Windows)</option>
              <option value="7">Last 7 Operational Days</option>
              <option value="30">Last 30 Calendar Days</option>
              <option value="custom">Custom Range 📅</option>
            </select>
          </div>

          <div className="flex flex-col space-y-1 lg:col-span-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Movement Direction
            </span>
            <select
              className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer w-full"
              value={filterMovementType}
              onChange={(e) => setFilterMovementType(e.target.value)}
            >
              <option value="All">All Traffic</option>
              <option value="Inward">Inward Only</option>
              <option value="Outward">Outward Only</option>
            </select>
          </div>

          {/* Dynamic input box matrices row mapping elements container */}
          {filterDateRange === "custom" && (
            <>
              <div className="flex flex-col space-y-1 lg:col-span-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                  From Date
                </span>
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary w-full"
                />
              </div>
              <div className="flex flex-col space-y-1 lg:col-span-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                  To Date
                </span>
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none focus:border-primary w-full"
                />
              </div>
            </>
          )}

          {/* Core Action Compute Trigger */}
          <div className="lg:col-span-2">
            <button
              onClick={handleApplyFilters}
              disabled={filtering}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-colors cursor-pointer"
            >
              {filtering ? "Computing..." : "Apply Matrix"}
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Alerts Banner */}
      {(duplicates.length > 0 ||
        notifications.filter((n) => n.type === "MissingODR" && !n.is_read).length > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/5 shadow-sm">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="text-sm text-red-300">
            {duplicates.length > 0 && (
              <span className="font-semibold">
                {duplicates.length} Duplicate Serial Values detected inside batch cluster.{" "}
              </span>
            )}
            {notifications.filter((n) => n.type === "MissingODR" && !n.is_read).length > 0 && (
              <span>
                {notifications.filter((n) => n.type === "MissingODR" && !n.is_read).length} Matured Indents missing ODR references.{" "}
              </span>
            )}
            {isAdmin && (
              <a
                href="/admin/notifications"
                className="underline font-medium text-red-400 hover:text-red-300 ml-1"
              >
                Open tracking console
              </a>
            )}
          </div>
        </div>
      )}

      {/* Main Matrix Charts Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
              Volume Distribution by Railway Division
            </h3>
          </div>
          {divisionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={divisionData} barSize={26}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="No active freight logs mapped to current filter limits." />
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">
            Inward Material Group Concentration
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={78} paddingAngle={3} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={getCommodityColor(entry.name)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="No inward metrics detected in timeline filter." />
          )}
        </div>
      </div>

      {/* Analytical Volume Feeds Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border border-emerald-500/20 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm uppercase tracking-wider text-foreground">
              Inward Aggregates
            </h3>
            <span className="ml-auto text-2xl font-black text-emerald-400">{inwardToday.length}</span>
          </div>
          <div className="space-y-2.5">
            {Object.entries(outwardCommodities).slice(0, 5).map(([comm, cnt]) => (
              <div key={comm} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-none">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: getCommodityColor(comm) }} />
                  <span className="text-xs font-medium text-muted-foreground">{comm}</span>
                </div>
                <span className="text-xs font-bold text-foreground">{cnt} units</span>
              </div>
            ))}
            {inwardToday.length === 0 && <div className="text-xs text-muted-foreground">No current data records found</div>}
          </div>
        </div>

        <div className="bg-card border border-blue-500/20 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpFromLine className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-sm uppercase tracking-wider text-foreground">
              Outward Aggregates
            </h3>
            <span className="ml-auto text-2xl font-black text-blue-400">{outwardToday.length}</span>
          </div>
          <div className="space-y-2.5">
            {Object.entries(outwardCommodities).slice(0, 5).map(([comm, cnt]) => (
              <div key={comm} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-none">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: getCommodityColor(comm) }} />
                  <span className="text-xs font-medium text-muted-foreground">{comm}</span>
                </div>
                <span className="text-xs font-bold text-foreground">{cnt} units</span>
              </div>
            ))}
            {outwardToday.length === 0 && <div className="text-xs text-muted-foreground">No current data records found</div>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <h3 className="font-bold text-sm uppercase tracking-wider text-foreground">
              Live Activity Stream
            </h3>
          </div>
          <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
            {notifications.slice(0, 10).map((n, i) => (
              <div key={n.id || i} className="flex items-start gap-2 text-xs border-b border-border/30 pb-2 last:border-none last:pb-0">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.severity === "error" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-foreground truncate leading-tight">{n.title}</div>
                  <div className="text-muted-foreground mt-0.5 truncate">{n.message}</div>
                </div>
              </div>
            ))}
            {notifications.length === 0 && <div className="text-xs text-muted-foreground">Stream idle. Waiting for upload sequences.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="flex items-center justify-center h-40 text-muted-foreground text-xs font-medium bg-muted/20 border border-dashed border-border rounded-lg">{text}</div>;
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-28 bg-muted rounded-xl animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-64 bg-muted rounded-xl animate-pulse" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
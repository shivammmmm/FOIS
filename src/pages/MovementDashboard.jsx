import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Layers3,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { base44 } from "@/api/base44Client";
import { getCommodityColor } from "@/utils/railwayDictionary";
import { formatStationNameAndCode } from "@/utils/stationMaster";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { buildFilterHierarchyOptions } from "@/utils/filterHierarchy";

export default function MovementDashboard({ direction = "Inward" }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hierarchy, setHierarchy] = useState(null);
  const [filters, setFilters] = useState({ zone: [], division: [], state: [], district: [], station: [], commodity: [], rake: [], company: [] });
  const isInward = direction === "Inward";
  const Icon = isInward ? ArrowDownToLine : ArrowUpFromLine;
  const accent = isInward ? "text-emerald-500" : "text-blue-500";
  const barColor = isInward ? "#10B981" : "#3B82F6";

  useEffect(() => { base44.filterHierarchy().then(setHierarchy).catch(() => undefined); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const data = await base44.movements.dashboardSummary({ direction, ...filters });
        if (!controller.signal.aborted) setSummary(data);
      } catch (error) {
        console.error(`[${direction}Dashboard] load failed:`, error);
        if (!controller.signal.aborted) setLoadError(error?.message || "Dashboard data could not be loaded");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [direction, filters]);

  const sourceOptions = summary?.options || { zone: [], division: [], state: [], district: [], station: [], commodity: [], rake: [], company: [] };
  const scoped = buildFilterHierarchyOptions(hierarchy || {}, { state: filters.state, district: filters.district, commodity: filters.commodity });
  const preferHierarchy = (hierarchyOptions, fallbackOptions) =>
    hierarchyOptions?.length ? hierarchyOptions : (fallbackOptions || []);
  const options = {
    ...sourceOptions,
    state: preferHierarchy(scoped.states, sourceOptions.state),
    district: preferHierarchy(scoped.districts, sourceOptions.district),
    station: preferHierarchy(scoped.stations, sourceOptions.station),
    commodity: preferHierarchy(scoped.commodities, sourceOptions.commodity),
    rake: preferHierarchy(scoped.rakeCmdts, sourceOptions.rake),
  };
  const unmappedCommodities = (hierarchy?.commodities || []).filter((item) => item.mapped === false);
  const stats = summary || { pending: "—", arrived: "—", departed: "—", delayed: "—", commodityData: [], divisionData: [], stationData: [], trendData: [] };

  const cards = isInward
    ? [
        { label: "Total Inward", value: summary ? summary.total : "—", icon: Layers3, color: "text-emerald-500" },
        { label: "Arrived", value: stats.arrived, icon: CheckCircle2, color: "text-emerald-500" },
        { label: "Pending", value: stats.pending, icon: Clock3, color: "text-amber-500" },
        { label: "Delayed", value: stats.delayed, icon: AlertTriangle, color: "text-red-500" },
      ]
    : [
        { label: "Total Outward", value: summary ? summary.total : "—", icon: Layers3, color: "text-blue-500" },
        { label: "Departed", value: stats.departed, icon: CheckCircle2, color: "text-blue-500" },
        { label: "Pending", value: stats.pending, icon: Clock3, color: "text-amber-500" },
        { label: "Delayed", value: stats.delayed, icon: AlertTriangle, color: "text-red-500" },
      ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${accent}`} />
            <h1 className="text-2xl font-bold text-foreground">{direction} Dashboard</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics for {direction.toLowerCase()} FOIS movements
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
        {[["zone","Zone"],["division","Division"],["state","State"],["district","District"],["station","Station"],["commodity","Commodity"],["rake","Rake CMDT"],["company","Company"]].map(([key, label]) => {
          const isCoreHierarchyFilter = ["state", "district", "station", "commodity", "rake"].includes(key);
          if (!isCoreHierarchyFilter && !options[key]?.length) return null;
          return <MultiSelectFilter key={key} label={label} selected={filters[key]} options={options[key] || []} disabled={(key === "district" && !filters.state.length) || (key === "station" && !filters.district.length) || (key === "rake" && !filters.commodity.length)} placeholder={key === "district" && !filters.state.length ? "Select State first" : key === "station" && !filters.district.length ? "Select District first" : key === "rake" && !filters.commodity.length ? "Select Commodity first" : `All ${label}`} onChange={(value) => setFilters((prev) => key === 'state' ? { ...prev, state: value, district: [], station: [] } : key === 'district' ? { ...prev, district: value, station: [] } : key === 'commodity' ? { ...prev, commodity: value, rake: [] } : { ...prev, [key]: value })} />;
        })}
        <button type="button" onClick={() => setFilters({ zone: [], division: [], state: [], district: [], station: [], commodity: [], rake: [], company: [] })} className="rounded-lg border border-border px-3 py-2 text-xs">Clear Filters</button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
          Dashboard API unavailable: {loadError}. Backend ko updated build ke saath restart/deploy karein.
        </div>
      )}

      {unmappedCommodities.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700">
          <span className="font-semibold">Commodity Master missing:</span>{" "}
          {unmappedCommodities.map((item) => item.code).join(", ")}. Raw freight codes filters mein available rahenge.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((card) => (
          <DashboardCard
            key={card.label}
            {...card}
            loading={loading}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartPanel title={`${direction} by Commodity`}>
          <HorizontalBarChart data={stats.commodityData} colorByCommodity fallbackColor={barColor} />
        </ChartPanel>
        <ChartPanel title={`${direction} by Division`}>
          <VerticalBarChart data={stats.divisionData} fill={barColor} />
        </ChartPanel>
        <ChartPanel title={`${direction} by Station`}>
          <HorizontalBarChart data={stats.stationData} fallbackColor={barColor} />
        </ChartPanel>
        <ChartPanel title={`${direction} Trend`}>
          <TrendChart data={stats.trendData} fill={barColor} />
        </ChartPanel>
      </div>
    </div>
  );
}

function DashboardCard({ label, value, icon: Icon, color, loading }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`text-3xl font-bold ${color}`}>{loading ? "-" : value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
      </div>
    </div>
  );
}

function ChartPanel({ title, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function HorizontalBarChart({ data, fallbackColor, colorByCommodity = false }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" barSize={16} margin={{ left: 8, right: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="count" fill={fallbackColor} radius={[0, 4, 4, 0]}>
          {colorByCommodity &&
            data.map((entry) => (
              <Cell key={entry.name} fill={getCommodityColor(entry.name)} />
            ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function VerticalBarChart({ data, fill }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} barSize={24}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="count" fill={fill} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TrendChart({ data, fill }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="count" stroke={fill} strokeWidth={2.5} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
      No data available
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};

function buildDashboardStats(records, direction) {
  const commodityMap = {};
  const divisionMap = {};
  const stationMap = {};
  const trendMap = {};
  let pending = 0;
  let arrived = 0;
  let departed = 0;
  let delayed = 0;

  records.forEach((record) => {
    const commodity = getCommodity(record);
    const division = record.division || "Unknown";
    const station =
      direction === "Inward"
        ? record.station_to || readRaw(record, "DSTN") || "Unknown"
        : record.station_from || readRaw(record, "STTN FROM") || "Unknown";
    const trendDate =
      direction === "Inward"
        ? record.arrival_date || readRaw(record, "DATE")
        : record.departure_date || readRaw(record, "DATE");

    commodityMap[commodity] = (commodityMap[commodity] || 0) + 1;
    divisionMap[division] = (divisionMap[division] || 0) + 1;
    stationMap[formatStationCode(station)] = (stationMap[formatStationCode(station)] || 0) + 1;
    if (trendDate) trendMap[String(trendDate).slice(0, 10)] = (trendMap[String(trendDate).slice(0, 10)] || 0) + 1;

    if (record.status === "Pending" || record.status === "In Transit") pending += 1;
    if (record.status === "Arrived") arrived += 1;
    if (record.status === "Departed") departed += 1;
    if (record.status === "Delayed") delayed += 1;
  });

  return {
    pending,
    arrived,
    departed,
    delayed,
    commodityData: mapChartData(commodityMap, 10),
    divisionData: mapChartData(divisionMap, 8),
    stationData: mapChartData(stationMap, 10),
    trendData: Object.entries(trendMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(-12),
  };
}

function mapChartData(map, limit) {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getCommodity(record) {
  return (
    record.commodity_name ||
    record.commodity_code ||
    record.commodity ||
    readRaw(record, "CMDT", "Commodity") ||
    "Unknown"
  );
}

function formatStationCode(station) {
  if (!station || station === "Unknown") return "Unknown";
  return formatStationNameAndCode(station);
}

function readRaw(record, ...keys) {
  const raw = record?.raw_data || {};
  const normalizedRaw = Object.entries(raw).reduce((acc, [key, value]) => {
    acc[String(key).trim().toUpperCase()] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value = raw[key] ?? normalizedRaw[String(key).trim().toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function getLocation(record, direction) {
  const inward = direction === "Inward";
  return {
    state: record[inward ? "to_state" : "from_state"] || readRaw(record, inward ? "State (To)" : "State (Source)"),
    district: record[inward ? "to_district" : "from_district"] || readRaw(record, inward ? "District (To)" : "District (Source)"),
    station: record[inward ? "station_to" : "station_from"] || "",
  };
}

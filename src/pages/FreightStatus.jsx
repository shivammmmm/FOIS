import { useCallback, useEffect, useState } from "react";
import { Clock3, Download, X } from "lucide-react";
import { base44 } from "@/api/base44Client";

const CARDS = [
  ["total_demands", "Total Demands"], ["pending", "Pending"], ["matured", "Matured"],
  ["partial", "Partially Supplied"], ["completed", "Completed"],
  ["total_indented_units", "Indented Units"], ["total_supplied_units", "Supplied Units"],
  ["balance_units", "Balance Units"], ["fulfilment_percentage", "Fulfilment"],
];

export default function FreightStatus() {
  const [summary, setSummary] = useState({});
  const [records, setRecords] = useState({ items: [], total: 0 });
  const [analytics, setAnalytics] = useState({});
  const [filters, setFilters] = useState({ status: "", search: "", page: 1, limit: 50 });
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cards, rows, chartData] = await Promise.all([
        base44.freightStatus.summary(filters), base44.freightStatus.records(filters), base44.freightStatus.analytics(filters),
      ]);
      setSummary(cards); setRecords(rows); setAnalytics(chartData);
    } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  const openTimeline = async (id) => setTimeline(await base44.freightStatus.timeline(id));
  const exportExcel = async () => { const blob=await base44.freightStatus.export(filters); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="My_Freight_Status.xlsx"; a.click(); URL.revokeObjectURL(url); };
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Freight Status</h1><p className="text-sm text-muted-foreground">Track your demands from creation to completed supply.</p></div><button onClick={exportExcel} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Download className="h-4 w-4"/>Export Excel</button></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9">
        {CARDS.map(([key, label]) => <button key={key} className="rounded-xl border border-border bg-card p-4 text-left">
          <div className="text-xl font-bold">{key === "fulfilment_percentage" ? `${Number(summary[key] || 0).toFixed(1)}%` : Number(summary[key] || 0).toLocaleString()}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </button>)}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Search demand, station, company..." className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none md:col-span-2" />
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option><option>Pending</option><option value="Matched">Matured</option><option value="Partial">Partially Supplied</option><option>Completed</option><option value="Manual Review">Under Verification</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr>
            {["Demand No.", "Division", "Source", "Destination", "Company", "Commodity", "Rake CMDT", "Demand Date", "Indented", "Supplied", "Balance", "Status", "Last Updated", "Timeline"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}
          </tr></thead>
          <tbody>
            {records.items.map((row) => <tr key={row.id} className="border-b border-border/60">
              <td className="px-3 py-3 font-medium">{row.odr?.odr_number || "-"}</td><td className="px-3">{row.odr?.division || "-"}</td>
              <td className="px-3">{row.odr?.station_from || "-"}</td><td className="px-3">{row.odr?.station_to || "-"}</td>
              <td className="px-3">{row.odr?.company || row.odr?.company_code || "-"}</td><td className="px-3">{row.odr?.commodity || "-"}</td>
              <td className="px-3">{row.odr?.rake_cmdt || row.odr?.rake_commodity_code || "-"}</td><td className="px-3">{row.odr?.departure_date || "-"}</td>
              <td className="px-3">{row.indented_units}</td><td className="px-3">{row.supplied_units}</td><td className="px-3">{row.balance_units}</td>
              <td className="px-3"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs">{row.status}</span></td>
              <td className="px-3">{row.updated_date ? new Date(row.updated_date).toLocaleString() : "-"}</td>
              <td className="px-3"><button onClick={() => openTimeline(row.id)} className="inline-flex items-center gap-1 text-primary"><Clock3 className="h-4 w-4" />View</button></td>
            </tr>)}
            {loading && <tr><td colSpan="14" className="p-10 text-center text-muted-foreground">Loading freight status...</td></tr>}
            {!loading && !records.items.length && <tr><td colSpan="14" className="p-10 text-center text-muted-foreground">No freight demands found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-sm"><span>{records.total || 0} demands</span><div className="space-x-2">
        <button disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
        <button disabled={filters.page * 50 >= records.total} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
      </div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><UserMetric title="Demand vs Supply" rows={analytics.by_division} /><UserMetric title="Commodity-wise Demand" rows={analytics.by_commodity} /><UserMetric title="Monthly Fulfilment" rows={analytics.monthly_fulfilment} /></div>
      {timeline && <div className="fixed inset-0 z-50 flex justify-end bg-black/50"><div className="h-full w-full max-w-md overflow-y-auto bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Demand Timeline</h2><p className="text-sm text-muted-foreground">{timeline.demand_no}</p></div><button onClick={() => setTimeline(null)}><X /></button></div>
        <div className="mt-8 space-y-6 border-l-2 border-primary/30 pl-5">{timeline.events.map((event, index) => <div key={`${event.event_type}-${index}`} className="relative">
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-primary" /><div className="font-medium">{event.event_type}</div>
          <div className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</div><p className="mt-1 text-sm">{event.message}</p>
          {event.units != null && <div className="text-xs">Units: {event.units}</div>}
        </div>)}</div>
      </div></div>}
    </div>
  );
}
function UserMetric({title,rows=[]}) { return <div className="rounded-xl border bg-card p-4"><h3 className="font-semibold">{title}</h3><div className="mt-3 space-y-2">{(rows||[]).slice(0,8).map((row)=><div key={row.name} className="flex justify-between text-sm"><span>{row.name}</span><span className="text-muted-foreground">{Number(row.demand||0).toLocaleString()} / {Number(row.supply||0).toLocaleString()}</span></div>)}{!rows?.length&&<p className="text-sm text-muted-foreground">No data available</p>}</div></div>; }

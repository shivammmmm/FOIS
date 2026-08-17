import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Search, Settings2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const STORAGE_KEY = "railflow:comparison-filters";
const EMPTY = { status: "", search: "", division: "", state: "", district: "", station_from: "", station_to: "", company: "", cnsg: "", commodity: "", rake_cmdt: "", batch_odr: "", batch_matured: "", match_method: "", confidence_min: "", confidence_max: "", upload_from: "", upload_to: "" };
const CARDS = [
  ["total_odr", "Total ODR Records", ""], ["total_matured", "Total Matured Records", ""],
  ["matched", "Matched", "Matched"], ["pending", "Pending ODR", "Pending"],
  ["unmatched_matured", "Unmatched Matured", "Unmatched"], ["partial", "Partial Matches", "Partial"],
  ["manual_review", "Manual Review", "Manual Review"], ["duplicate_odr", "Duplicate ODR", "Duplicate"],
  ["duplicate_matured", "Duplicate Matured", "Duplicate"], ["completed", "Completed Supply", "Completed"],
];
const FIELD_PAIRS = [
  ["Number", "odr_number", "indent_number"], ["Division", "division", "division"],
  ["Station From", "station_from", "station_from"], ["Destination", "station_to", "station_to"],
  ["CNSR", "company", "company"], ["CNSG", "raw_data.cnsg", "raw_data.cnsg"],
  ["Commodity", "commodity", "commodity"], ["Rake CMDT", "rake_cmdt", "rake_cmdt"],
  ["Date", "departure_date", "indent_date"], ["Upload Batch", "upload_batch_id", "upload_batch_id"],
];
const get = (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj);
const display = (value) => value === undefined || value === null || value === "" ? "-" : String(value);

export default function MatchingComparison() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({});
  const [result, setResult] = useState({ items: [], total: 0 });
  const [options, setOptions] = useState({});
  const [analytics, setAnalytics] = useState({});
  const [filters, setFilters] = useState(() => {
    try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; } catch { return EMPTY; }
  });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [runs, setRuns] = useState([]);
  const [showRuns, setShowRuns] = useState(false);
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [apiError, setApiError] = useState("");
  const query = useMemo(() => ({ ...filters, page, limit: 50 }), [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setApiError("");
    try {
      const [cards, rows, filterOptions, chartData] = await Promise.all([
        base44.admin.comparison.summary(), base44.admin.comparison.records(query),
        base44.admin.comparison.filters(), base44.admin.comparison.analytics(filters),
      ]);
      setSummary({
        ...cards,
        pending: cards.pending ?? cards.pending_odr ?? 0,
        partial: cards.partial ?? cards.partial_matches ?? 0,
        completed: cards.completed ?? cards.completed_supply ?? 0,
        matching_duration: cards.matching_duration ?? cards.matching_duration_ms ?? 0,
      });
      setResult({ ...rows, items: rows.items || rows.records || [] });
      setOptions(filterOptions);
      setAnalytics(chartData);
    } catch (error) {
      const message = error?.message || "Comparison API is unavailable. Please restart the backend or verify the comparison routes.";
      setFeedback(message); setApiError(message);
    }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); void load(); }, [filters, load]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "state") { next.district = ""; next.station_from = ""; }
      if (key === "commodity") next.rake_cmdt = "";
      return next;
    });
  };
  const reprocess = async (scope = { type: "all" }) => {
    if (!window.confirm(`Reprocess scope: ${scope.type}. Protected manual decisions overwrite nahi honge. Continue?`)) return;
    setReprocessing(true);
    try {
      const response = await base44.admin.comparison.reprocess({ scope });
      setFeedback(`Completed: ${response.matched || 0} matched, ${response.partial || 0} partial, ${response.completed || 0} completed in ${response.elapsed_ms || 0} ms.`);
      await load();
    } catch (error) { setFeedback(error?.message || "Reprocess failed."); }
    finally { setReprocessing(false); }
  };
  const resetManual = async () => {
    if (!window.confirm("All protected manual decisions reset karke complete matching dobara chalani hai? This cannot be undone.")) return;
    setReprocessing(true);
    try { const response=await base44.admin.comparison.resetManualDecisions(); setFeedback(`${response.affected_count||0} manual decisions reset; matching completed.`); await load(); }
    finally { setReprocessing(false); }
  };
  const openDetail = async (id) => setDetail(await base44.admin.comparison.detail(id));
  const unmatch = async () => {
    if (!window.confirm("Selected match ko unmatch karke manual no-match lock lagana hai?")) return;
    const note = window.prompt("Resolution note") || "";
    setDetail(await base44.admin.comparison.unmatch(detail.match_id, { note })); await load();
  };
  const resolve = async (maturedId) => {
    if (!window.confirm("Selected Matured record ko authoritative manual match banana hai?")) return;
    const note = window.prompt("Resolution note") || "";
    setDetail(await base44.admin.comparison.resolve(detail.match_id, { matured_id: maturedId, note })); await load();
  };
  const exportExcel = async () => {
    const blob = await base44.admin.comparison.export(filters);
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "ODR_Matured_Comparison.xlsx"; link.click(); URL.revokeObjectURL(url);
  };
  const loadRuns = async () => { const response = await base44.admin.comparison.runs(); setRuns(response.items || []); setShowRuns(true); };
  const loadRules = async () => setRules(await base44.admin.comparison.rules());
  const saveRuleConfig = async () => { setRules(await base44.admin.comparison.saveRules(rules.config)); setFeedback("Rule version saved and matching reprocessed."); await load(); };

  if (apiError) return <div className="p-6"><div className="mx-auto max-w-xl rounded-xl border border-red-500/30 bg-card p-6 text-center"><h1 className="text-xl font-bold">ODR–Matured Comparison</h1><p className="mt-3 text-sm text-red-500">{apiError}</p><button onClick={load} className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Retry</button></div></div>;

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">ODR–Matured Comparison</h1><p className="text-sm text-muted-foreground">Authoritative matching and exception management</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={loadRuns} className="rounded-lg border px-3 py-2 text-sm">Run History</button>{user?.role==="super_admin"&&<><button onClick={loadRules} className="rounded-lg border px-3 py-2 text-sm">Match Rules</button><button onClick={resetManual} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-500">Reset Manual Decisions</button></>}<button onClick={exportExcel} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Download className="h-4 w-4" />Excel</button>
      <button onClick={() => reprocess()} disabled={reprocessing} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />{reprocessing ? "Reprocessing..." : "Reprocess Matching"}</button></div>
    </div>
    {feedback && <div className="rounded-lg border bg-card px-4 py-3 text-sm">{feedback}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{CARDS.map(([key, label, status]) => <button key={key} onClick={() => status && setFilter("status", status)} className="rounded-xl border bg-card p-4 text-left hover:border-primary/50"><div className="text-2xl font-bold">{Number(summary[key] || 0).toLocaleString()}</div><div className="text-xs text-muted-foreground">{label}</div></button>)}
      <div className="rounded-xl border bg-card p-4"><div className="text-sm font-bold">{summary.last_matching_run ? new Date(summary.last_matching_run).toLocaleString() : "-"}</div><div className="text-xs text-muted-foreground">Last Matching Run</div></div>
      <div className="rounded-xl border bg-card p-4"><div className="text-2xl font-bold">{Number(summary.matching_duration || 0).toLocaleString()} ms</div><div className="text-xs text-muted-foreground">Matching Duration</div></div>
    </div>
    <div className="rounded-xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4" />Filters</h2><button onClick={() => setFilters(EMPTY)} className="text-xs text-primary">Clear all</button></div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"><label className="flex items-center gap-2 rounded-lg border px-3"><Search className="h-4 w-4" /><input value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Search..." className="w-full bg-transparent py-2 text-sm outline-none" /></label>
        <Select label="Status" value={filters.status} values={["Matched","Pending","Partial","Completed","Manual Review","Duplicate","Unmatched"]} onChange={(v) => setFilter("status",v)} />
        <Select label="Division" value={filters.division} values={options.divisions} onChange={(v) => setFilter("division",v)} />
        <Select label="State" value={filters.state} values={options.states} onChange={(v) => setFilter("state",v)} /><Select label="District" value={filters.district} values={(options.districts||[]).filter((item)=>!filters.state||item.state===filters.state)} onChange={(v) => setFilter("district",v)} />
        <Select label="Station From" value={filters.station_from} values={options.stations_from} onChange={(v) => setFilter("station_from",v)} />
        <Select label="Destination" value={filters.station_to} values={options.destinations} onChange={(v) => setFilter("station_to",v)} />
        <Select label="Company/CNSR" value={filters.company} values={options.companies} onChange={(v) => setFilter("company",v)} />
        <Select label="CNSG" value={filters.cnsg} values={options.cnsgs} onChange={(v) => setFilter("cnsg",v)} />
        <Select label="Commodity" value={filters.commodity} values={options.commodities} onChange={(v) => setFilter("commodity",v)} />
        <Select label="Rake CMDT" value={filters.rake_cmdt} values={options.rake_cmdts} onChange={(v) => setFilter("rake_cmdt",v)} />
        <Select label="ODR Batch" value={filters.batch_odr} values={options.odr_batches} onChange={(v) => setFilter("batch_odr",v)} />
        <Select label="Matured Batch" value={filters.batch_matured} values={options.matured_batches} onChange={(v) => setFilter("batch_matured",v)} />
        <Select label="Match Method" value={filters.match_method} values={options.match_methods} onChange={(v) => setFilter("match_method",v)} />
        <Text label="Min confidence" type="number" value={filters.confidence_min} onChange={(v) => setFilter("confidence_min",v)} />
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[2100px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr>{["ODR Number","Division","Station From","Destination","CNSR / Company","CNSG","Commodity","Rake CMDT","Demand Date","Indented","Supplied","Balance","Matured Indent","Status","Confidence","Method","ODR Batch","Matured Batch","Matched On","Actions"].map((h)=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
      <tbody>{result.items.map((row)=>{const overSupplied=Boolean(row.over_supplied);return <tr key={row.match_id} className={`border-b border-border/60 ${overSupplied ? "bg-red-500/10" : ""}`}><td className="px-3 py-3 font-medium">{display(row.odr?.odr_number)}</td><td className="px-3">{display(row.odr?.division)}</td><td className="px-3">{display(row.odr?.station_from)}</td><td className="px-3">{display(row.odr?.station_to)}</td><td className="px-3">{display(row.odr?.company || row.odr?.company_code)}</td><td className="px-3">{display(row.odr?.raw_data?.cnsg)}</td><td className="px-3">{display(row.odr?.commodity)}</td><td className="px-3">{display(row.odr?.rake_cmdt || row.odr?.rake_commodity_code)}</td><td className="px-3">{display(row.odr?.departure_date)}</td><td className="px-3">{row.indented_units}</td><td className="px-3">{row.supplied_units}{overSupplied && <AlertTriangle title="Supplied units exceed indented units (FOIS source data)" className="ml-1 inline h-3.5 w-3.5 text-red-500" />}</td><td className="px-3">{row.balance_units}</td><td className="px-3">{display(row.matured?.indent_number)}</td><td className="px-3"><span className="rounded-full bg-muted px-2 py-1 text-xs">{row.status}</span></td><td className="px-3">{Number(row.confidence)}%</td><td className="px-3">{row.match_method}</td><td className="px-3">{display(row.batch_odr)}</td><td className="px-3">{display(row.batch_matured)}</td><td className="px-3">{row.matched_on ? new Date(row.matched_on).toLocaleString() : "-"}</td><td className="px-3"><button onClick={()=>openDetail(row.match_id)} className="text-primary">View / Resolve</button></td></tr>;})}
      {loading && <tr><td colSpan="20" className="p-10 text-center">Loading...</td></tr>}{!loading&&!result.items.length&&<tr><td colSpan="20" className="p-10 text-center text-muted-foreground">No comparison records</td></tr>}</tbody></table></div>
    <div className="flex justify-between text-sm"><span>{Number(result.total||0).toLocaleString()} records</span><div className="space-x-2"><button disabled={page<=1} onClick={()=>setPage(page-1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><span>Page {page}</span><button disabled={page*50>=result.total} onClick={()=>setPage(page+1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div></div>
    <div className="grid gap-4 lg:grid-cols-3"><MetricList title="Demand vs Supply by Division" rows={analytics.by_division} /><MetricList title="Match Status Distribution" rows={(analytics.status_distribution||[]).map((r)=>({name:r.name,demand:r.value,supply:0}))} /><MetricList title={`Pending Aging · oldest ${analytics.oldest_pending_days||0} days`} rows={(analytics.aging||[]).map((r)=>({name:r.name,demand:r.count,supply:r.units}))} /></div>
    {detail && <DetailPanel detail={detail} close={()=>setDetail(null)} resolve={resolve} unmatch={unmatch} reprocess={()=>reprocess({type:"record",odr_id:detail.odr_id})} />}
    {showRuns && <RunsPanel runs={runs} close={()=>setShowRuns(false)} />}
    {rules && <RulesPanel rules={rules} setRules={setRules} save={saveRuleConfig} close={()=>setRules(null)} />}
  </div>;
}

function Select({label,value,values=[],onChange}) { return <select title={label} value={value} onChange={(e)=>onChange(e.target.value)} className="min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"><option value="">{label}: All</option>{(values||[]).map((item)=>{const v=typeof item==="object"?item.value:item;const text=typeof item==="object"?item.label:item;return <option key={v} value={v}>{text}{text!==v?` (${v})`:""}</option>;})}</select>; }
function Text({label,value,onChange,type="text"}) { return <input title={label} type={type} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={label} className="min-w-0 rounded-lg border bg-background px-3 py-2 text-sm" />; }
function DetailPanel({detail,close,resolve,unmatch,reprocess}) { return <div className="fixed inset-0 z-50 flex justify-end bg-black/50"><div className="h-full w-full max-w-5xl overflow-y-auto bg-background p-6"><div className="flex justify-between"><div><h2 className="text-xl font-bold">Side-by-Side Comparison</h2><p className="text-sm text-muted-foreground">{detail.match_method} · {detail.confidence}% · Rule {detail.match_rule_version}</p></div><button onClick={close}><X /></button></div>
  <div className="mt-6 overflow-hidden rounded-xl border"><div className="grid grid-cols-3 bg-muted/50 p-3 text-xs font-semibold uppercase"><span>Field</span><span>ODR Record</span><span>Matured Record</span></div>{FIELD_PAIRS.map(([label,a,b])=>{const left=display(get(detail.odr,a)),right=display(get(detail.matured,b));const cls=left==="-"||right==="-"?"bg-red-500/10":left===right?"bg-emerald-500/10":"bg-amber-500/10";return <div key={label} className={`grid grid-cols-3 border-t p-3 text-sm ${cls}`}><span className="font-medium">{label}</span><span>{left}</span><span>{right}</span></div>;})}</div>
  <div className="mt-4 grid gap-2 rounded-xl border p-4 text-sm md:grid-cols-2"><div><b>Status:</b> {detail.status}</div><div><b>Reason:</b> {detail.reason}</div><div><b>Matched on:</b> {detail.matched_on||"-"}</div><div><b>Resolved by:</b> {detail.resolved_by||detail.matched_by||"System"}</div><div className="md:col-span-2"><b>Resolution note:</b> {detail.resolution_note||"-"}</div></div>
  <div className="mt-5 flex flex-wrap gap-2"><button onClick={reprocess} className="rounded border px-3 py-2 text-sm">Re-run Record</button>{detail.matured_id&&<button onClick={unmatch} className="rounded border border-red-500/40 px-3 py-2 text-sm text-red-500">Unmatch</button>}</div>
  {!!detail.candidates?.length&&<div className="mt-6"><h3 className="font-semibold">Possible Matured Records</h3><div className="mt-2 space-y-2">{detail.candidates.map((c)=><div key={c.id} className="flex items-center justify-between rounded border p-3 text-sm"><span>{c.data?.indent_number} · {c.data?.station_from} → {c.data?.station_to} · {c.data?.commodity}</span><button onClick={()=>resolve(c.id)} className="rounded bg-primary px-3 py-1 text-primary-foreground">Confirm Match</button></div>)}</div></div>}
 </div></div>; }
function RunsPanel({runs,close}) { return <div className="fixed inset-0 z-50 flex justify-end bg-black/50"><div className="h-full w-full max-w-3xl overflow-y-auto bg-background p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">Matching Run History</h2><button onClick={close}><X /></button></div><div className="mt-5 space-y-3">{runs.map((run)=><div key={run.run_id} className="rounded-xl border p-4 text-sm"><div className="flex justify-between"><b>{run.trigger_type}</b><span>{run.status}</span></div><div className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground md:grid-cols-4"><span>{new Date(run.started_at).toLocaleString()}</span><span>Rule {run.rule_version}</span><span>{run.odr_scanned} ODR</span><span>{run.duration_ms||0} ms</span><span>Matched {run.matched}</span><span>Pending {run.pending}</span><span>Partial {run.partial}</span><span>Review {run.ambiguous}</span></div>{run.error_message&&<p className="mt-2 text-red-500">{run.error_message}</p>}</div>)}</div></div></div>; }
function RulesPanel({rules,setRules,save,close}) { const update=(key,value)=>setRules((r)=>({...r,config:{...r.config,[key]:value}})); return <div className="fixed inset-0 z-50 flex justify-end bg-black/50"><div className="h-full w-full max-w-lg overflow-y-auto bg-background p-6"><div className="flex justify-between"><div><h2 className="text-xl font-bold">Match Rule Configuration</h2><p className="text-sm text-muted-foreground">Current version {rules.version}</p></div><button onClick={close}><X /></button></div><div className="mt-6 space-y-4">
  <RuleInput label="New rule version" value={rules.config.version} onChange={(v)=>update("version",v)} />
  <RuleInput label="Date tolerance (days)" type="number" value={rules.config.date_tolerance_days} onChange={(v)=>update("date_tolerance_days",Number(v))} />
  <RuleInput label="Unit tolerance" type="number" value={rules.config.unit_tolerance} onChange={(v)=>update("unit_tolerance",Number(v))} />
  <RuleInput label="Auto-match threshold" type="number" value={rules.config.auto_match_threshold} onChange={(v)=>update("auto_match_threshold",Number(v))} />
  <RuleInput label="Manual-review threshold" type="number" value={rules.config.manual_review_threshold} onChange={(v)=>update("manual_review_threshold",Number(v))} />
  <label className="block text-sm"><span>Blank-value policy</span><select value={rules.config.blank_value_policy} onChange={(e)=>update("blank_value_policy",e.target.value)} className="mt-1 w-full rounded border bg-background px-3 py-2"><option value="allow_but_flag">Allow but flag</option><option value="manual_review">Manual review</option><option value="reject">Reject</option></select></label>
  <div className="rounded border p-3 text-xs text-muted-foreground">Required exact: {(rules.config.required_exact_fields||[]).join(", ")}<br/>Strong: {(rules.config.strong_fields||[]).join(", ")}</div>
  <button onClick={save} className="w-full rounded bg-primary px-4 py-2 text-primary-foreground">Save Rules & Reprocess</button>
 </div></div></div>; }
function RuleInput({label,value,onChange,type="text"}) { return <label className="block text-sm"><span>{label}</span><input type={type} value={value??""} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded border bg-background px-3 py-2" /></label>; }
function MetricList({title,rows=[]}) { return <div className="rounded-xl border bg-card p-4"><h3 className="font-semibold">{title}</h3><div className="mt-3 space-y-2">{rows.slice(0,8).map((row)=><div key={row.name} className="flex justify-between text-sm"><span className="truncate">{row.name}</span><span className="text-muted-foreground">{Number(row.demand||0).toLocaleString()} / {Number(row.supply||0).toLocaleString()}</span></div>)}{!rows.length&&<p className="text-sm text-muted-foreground">No data</p>}</div></div>; }

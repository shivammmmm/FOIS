import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { FileText, Download, Loader2, Filter, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getCommodityName } from '@/utils/railwayDictionary';
import StatusBadge from '@/components/StatusBadge';
import { useAuth } from '@/lib/AuthContext';
import FreightDetailsModal from '@/components/FreightDetailsModal';

const REPORT_TYPES = [
  { id: 'inward', label: '🚆 Inward Report', desc: 'All inward freight movements' },
  { id: 'outward', label: '🚆 Outward Report', desc: 'All outward freight dispatches' },
  { id: 'delayed', label: '⚠️ Delayed Movement', desc: 'Overdue and delayed trains' },
  { id: 'duplicate', label: '⚠️ Duplicate ODR', desc: 'Duplicate ODR records found' },
  { id: 'division', label: '📍 Division Report', desc: 'Movement summary by division' },
  { id: 'all', label: '📋 Full ODR Report', desc: 'All freight movement records' },
];

export default function Reports() {
  const { user } = useAuth();
  const [movements, setMovements] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportType, setReportType] = useState('inward');
  const [filterDivision, setFilterDivision] = useState('All');
  const [filterCommodity, setFilterCommodity] = useState('All');
  const [exporting, setExporting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await base44.entities.FreightMovement.list('-created_date', 2000);
        setMovements(data);
        if (user?.id) {
          const filters = await base44.entities.SavedFilter.filter({ user_id: user.id }, '-created_at', 100);
          setSavedFilters(filters);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const divisions = ['All', ...new Set(movements.map(r => r.division).filter(Boolean))];
  const commodities = ['All', ...new Set(movements.map(r => r.commodity).filter(Boolean))];

  const getReportData = () => {
    let data = [...movements];
    if (filterDivision !== 'All') data = data.filter(r => r.division === filterDivision);
    if (filterCommodity !== 'All') data = data.filter(r => r.commodity === filterCommodity);
    switch (reportType) {
      case 'inward': return data.filter(r => r.movement_type === 'Inward');
      case 'outward': return data.filter(r => r.movement_type === 'Outward');
      case 'delayed': return data.filter(r => r.status === 'Delayed');
      case 'duplicate': return data.filter(r => r.is_duplicate);
      case 'division': {
        const divMap = {};
        data.forEach(r => {
          const d = r.division || 'Unknown';
          if (!divMap[d]) divMap[d] = { division: d, total: 0, inward: 0, outward: 0, delayed: 0 };
          divMap[d].total++;
          if (r.movement_type === 'Inward') divMap[d].inward++;
          if (r.movement_type === 'Outward') divMap[d].outward++;
          if (r.status === 'Delayed') divMap[d].delayed++;
        });
        return Object.values(divMap).sort((a, b) => b.total - a.total);
      }
      default: return data;
    }
  };

  const reportData = getReportData();
  const isDivisionReport = reportType === 'division';

  const exportExcel = () => {
    setExporting(true);
    try {
      const rows = isDivisionReport ? reportData : reportData.map(r => ({
        'ODR Number': r.odr_number || '',
        'Zone': r.zone || '',
        'Division': r.division || '',
        'From Station': r.station_from || '',
        'To Station': r.station_to || '',
        'Commodity': getCommodityName(r.commodity) || '',
        'Rake CMDT': r.rake_commodity_code || r.rake_cmdt || '',
        'Wagons': r.wagons || '',
        'Arrival Date': r.arrival_date || '',
        'Departure Date': r.departure_date || '',
        'Movement Type': r.movement_type || '',
        'Status': r.status || '',
        'Is Duplicate': r.is_duplicate ? 'Yes' : 'No',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, `RailFlow_${reportType}_report_${Date.now()}.xlsx`);
    } catch (e) { console.error(e); }
    setExporting(false);
  };

  const currentReport = REPORT_TYPES.find(r => r.id === reportType);

  const saveCurrentFilter = async () => {
    if (!user?.id) return;
    const filterState = { reportType, filterDivision, filterCommodity };
    const name = [reportType, filterDivision, getCommodityName(filterCommodity)]
      .filter(v => v && v !== 'All' && v !== '—')
      .join(' + ') || 'Report Filter';
    const saved = await base44.entities.SavedFilter.create({
      user_id: user.id,
      name,
      source: 'Reports',
      filters: filterState,
    });
    setSavedFilters(prev => [saved, ...prev]);
  };

  const applySavedFilter = (id) => {
    const saved = savedFilters.find(f => f.id === id);
    if (!saved?.filters) return;
    setReportType(saved.filters.reportType || 'inward');
    setFilterDivision(saved.filters.filterDivision || 'All');
    setFilterCommodity(saved.filters.filterCommodity || 'All');
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Generate and export freight operation reports</p>
        </div>
        <button
          onClick={exportExcel}
          disabled={exporting || reportData.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export Excel
        </button>
      </div>

      {/* Report type selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {REPORT_TYPES.map(rt => (
          <button
            key={rt.id}
            onClick={() => setReportType(rt.id)}
            className={`p-3 rounded-xl border text-left transition-all ${
              reportType === rt.id
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            <div className="text-xs font-medium leading-tight">{rt.label}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-tight">{rt.desc}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="w-4 h-4" />
          <span>Filters:</span>
        </div>
        <select value={filterDivision} onChange={e => setFilterDivision(e.target.value)}
          className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none">
          {divisions.map(d => <option key={d} value={d}>{d === 'All' ? 'All Divisions' : d}</option>)}
        </select>
        <select value={filterCommodity} onChange={e => setFilterCommodity(e.target.value)}
          className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none">
          {commodities.map(c => <option key={c} value={c}>{c === 'All' ? 'All Commodities' : getCommodityName(c)}</option>)}
        </select>
        <button onClick={saveCurrentFilter}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-1.5 text-sm text-primary hover:bg-primary/10">
          <Save className="h-4 w-4" />
          Save Filter
        </button>
        {savedFilters.length > 0 && (
          <select onChange={e => applySavedFilter(e.target.value)} value="All"
            className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-1.5 outline-none">
            <option value="All">Apply Saved Filter</option>
            {savedFilters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{reportData.length} records</span>
      </div>

      {/* Report Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">{currentReport?.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{currentReport?.desc}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {isDivisionReport ? (
                  ['Division', 'Total Racks', 'Inward', 'Outward', 'Delayed'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                  ))
                ) : (
                  ['ODR No.', 'Zone', 'Division', 'Route', 'Commodity', 'Rake CMDT', 'Wagons', 'Arrival', 'Movement', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(isDivisionReport ? 5 : 10)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                  ))}
                </tr>
              )) : reportData.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No data for this report. Upload FOIS data first.
                </td></tr>
              ) : isDivisionReport ? (
                reportData.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3 font-semibold text-foreground">{row.division}</td>
                    <td className="px-4 py-3 text-center font-bold text-primary">{row.total}</td>
                    <td className="px-4 py-3 text-center text-emerald-400 font-medium">{row.inward}</td>
                    <td className="px-4 py-3 text-center text-blue-400 font-medium">{row.outward}</td>
                    <td className="px-4 py-3 text-center">{row.delayed > 0 ? <span className="text-red-400 font-medium">{row.delayed}</span> : <span className="text-muted-foreground">0</span>}</td>
                  </tr>
                ))
              ) : (
                reportData.slice(0, 100).map(r => (
                  <tr key={r.id} onClick={() => setSelectedRecord(r)} className={`cursor-pointer border-b border-border/50 hover:bg-muted/30 ${r.is_duplicate ? 'bg-orange-500/5' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-primary font-medium">
                      {r.odr_number}{r.is_duplicate && <span className="ml-1 text-orange-400 text-[10px]">⚠ DUP</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.zone || '—'}</td>
                    <td className="px-4 py-3 text-foreground">{r.division || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className="bg-muted px-1.5 py-0.5 rounded">{r.station_from || '?'}</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="bg-muted px-1.5 py-0.5 rounded">{r.station_to || '?'}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{getCommodityName(r.commodity) || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.rake_commodity_code || r.rake_cmdt || '—'}</td>
                    <td className="px-4 py-3 text-center text-foreground">{r.wagons || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.arrival_date || '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.movement_type} /></td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isDivisionReport && reportData.length > 100 && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            Showing 100 of {reportData.length} records. Export to Excel to get all records.
          </div>
        )}
      </div>
      <FreightDetailsModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

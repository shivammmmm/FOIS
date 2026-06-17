import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { getCommodityColor, getCommodityName } from '@/utils/railwayDictionary';
import { BarChart3 } from 'lucide-react';

export default function Analytics() {
  const [movements, setMovements] = useState([]);
  const [indents, setIndents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [mv, ind] = await Promise.all([
          base44.entities.FreightMovement.list('-created_date', 1000),
          base44.entities.MaturedIndent.list('-created_date', 500),
        ]);
        setMovements(mv);
        setIndents(ind);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  // Division breakdown
  const divMap = {};
  movements.forEach(m => { const d = m.division || 'Unknown'; divMap[d] = (divMap[d] || 0) + 1; });
  const divData = Object.entries(divMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // Commodity breakdown
  const commMap = {};
  movements.forEach(m => { const c = getCommodityName(m.commodity || 'Unknown'); commMap[c] = (commMap[c] || 0) + 1; });
  const commPie = Object.entries(commMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7);

  // Inward vs Outward
  const inwardCount = movements.filter(m => m.movement_type === 'Inward').length;
  const outwardCount = movements.filter(m => m.movement_type === 'Outward').length;
  const unknownCount = movements.filter(m => m.movement_type === 'Unknown').length;
  const movTypeData = [
    { name: 'Inward', value: inwardCount, color: '#10B981' },
    { name: 'Outward', value: outwardCount, color: '#3B82F6' },
    { name: 'Unknown', value: unknownCount, color: '#6B7280' },
  ].filter(d => d.value > 0);

  // Status distribution
  const statusMap = {};
  movements.forEach(m => { const s = m.status || 'Unknown'; statusMap[s] = (statusMap[s] || 0) + 1; });
  const statusData = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

  // Rake type
  const rakeMap = {};
  movements.forEach(m => { const r = m.rake_type || 'Unknown'; rakeMap[r] = (rakeMap[r] || 0) + 1; });
  const rakeData = Object.entries(rakeMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // ODR vs Indent comparison
  const odrCount = movements.length;
  const indentCount = indents.length;
  const matchedCount = indents.filter(i => i.odr_matched).length;
  const missingCount = indentCount - matchedCount;

  const STATUS_COLORS = {
    Pending: '#F59E0B', 'In Transit': '#06B6D4', Arrived: '#10B981', Departed: '#3B82F6', Delayed: '#EF4444', Unknown: '#6B7280'
  };

  if (loading) return (
    <div className="p-6 space-y-6">
      {[...Array(4)].map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Freight movement insights — {movements.length} total records</p>
      </div>

      {/* ODR vs Indent summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total ODR Records', value: odrCount, color: 'text-primary' },
          { label: 'Matured Indents', value: indentCount, color: 'text-purple-400' },
          { label: 'Matched Pairs', value: matchedCount, color: 'text-emerald-400' },
          { label: 'Missing ODRs', value: missingCount, color: 'text-red-400' },
        ].map(c => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4">
            <div className={`text-3xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-sm text-muted-foreground mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Movements by Division</h3>
          {divData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={divData} barSize={26}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Inward vs Outward</h3>
          {movTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={movTypeData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {movTypeData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Commodity Distribution</h3>
          {commPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={commPie} layout="vertical" barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {commPie.map((entry, i) => <Cell key={i} fill={getCommodityColor(entry.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Status Distribution</h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" outerRadius={85} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={true}>
                  {statusData.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.name] || '#6B7280'} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>
      </div>

      {/* Rake type chart */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-4">Rake Type Usage</h3>
        {rakeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rakeData} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
              <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </div>
    </div>
  );
}

function EmptyState() {
  return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Upload FOIS data to see analytics</div>;
}

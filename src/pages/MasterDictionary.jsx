import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BookOpen, Plus, Pencil, Trash2, Search, X, Check } from 'lucide-react';
import { RAILWAY_DICTIONARY } from '@/utils/railwayDictionary';

const CATEGORIES = ['RakeType', 'Commodity', 'Station', 'Division', 'Zone', 'Other'];

export default function MasterDictionary() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ code: '', readable_name: '', category: 'RakeType', description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadEntries(); }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.RailwayDictionary.list('code', 500);
      setEntries(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const seedBuiltIn = async () => {
    setSaving(true);
    const entries = Object.entries(RAILWAY_DICTIONARY).map(([code, readable_name]) => ({
      code,
      readable_name,
      category: guessCategory(code),
      description: '',
    }));
    await base44.entities.RailwayDictionary.bulkCreate(entries);
    loadEntries();
    setSaving(false);
  };

  const guessCategory = (code) => {
    const c = code.toUpperCase();
    if (['BOX', 'BCN', 'BTP', 'BLC', 'BFN', 'AUTO', 'LPG', 'BALT', 'STON', 'RMC'].some(p => c.startsWith(p))) return 'RakeType';
    if (['HSD', 'POL', 'FCI', 'FERT', 'COAL', 'ORES', 'STEE', 'CEME', 'CONT', 'FOOD', 'SALT', 'SUGR', 'LIME', 'GRAV', 'SAND'].includes(c)) return 'Commodity';
    if (['CR', 'WR', 'SCR', 'SR', 'NR', 'ER', 'NER', 'NFR', 'ECR', 'SER', 'BB', 'PUNE', 'NGP', 'SUR'].includes(c)) return 'Zone';
    return 'Other';
  };

  const handleSave = async () => {
    if (!form.code || !form.readable_name) return;
    setSaving(true);
    if (editing) {
      await base44.entities.RailwayDictionary.update(editing.id, form);
    } else {
      await base44.entities.RailwayDictionary.create(form);
    }
    setShowForm(false);
    setEditing(null);
    setForm({ code: '', readable_name: '', category: 'RakeType', description: '' });
    loadEntries();
    setSaving(false);
  };

  const handleEdit = (entry) => {
    setEditing(entry);
    setForm({ code: entry.code, readable_name: entry.readable_name, category: entry.category || 'Other', description: entry.description || '' });
    setShowForm(true);
  };

  const handleDelete = async (entry) => {
    await base44.entities.RailwayDictionary.delete(entry.id);
    loadEntries();
  };

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q || e.code?.toLowerCase().includes(q) || e.readable_name?.toLowerCase().includes(q);
    const matchCat = filterCat === 'All' || e.category === filterCat;
    return matchSearch && matchCat;
  });

  const catColors = {
    RakeType: 'bg-blue-500/15 text-blue-400',
    Commodity: 'bg-emerald-500/15 text-emerald-400',
    Station: 'bg-purple-500/15 text-purple-400',
    Division: 'bg-cyan-500/15 text-cyan-400',
    Zone: 'bg-amber-500/15 text-amber-400',
    Other: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Master Dictionary</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">FOIS short code to readable name mappings</p>
        </div>
        <div className="flex gap-2">
          {entries.length === 0 && (
            <button onClick={seedBuiltIn} disabled={saving}
              className="px-4 py-2 bg-muted border border-border text-foreground text-sm rounded-lg hover:bg-muted/80 transition-colors">
              {saving ? 'Loading...' : '🌱 Load Built-in Codes'}
            </button>
          )}
          <button
            onClick={() => { setEditing(null); setForm({ code: '', readable_name: '', category: 'RakeType', description: '' }); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Code
          </button>
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-card border border-primary/20 rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">{editing ? 'Edit Code' : 'Add New Code'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">FOIS Code *</label>
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. BOXNHL"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 font-mono" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Readable Name *</label>
              <input value={form.readable_name} onChange={e => setForm({ ...form, readable_name: e.target.value })}
                placeholder="e.g. High Load Box Wagon"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Optional details"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving || !form.code || !form.readable_name}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              <Check className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-3">
        <div className="flex items-center gap-2 flex-1 bg-muted border border-border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
          {search && <X className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" onClick={() => setSearch('')} />}
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none">
          {['All', ...CATEGORIES].map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['FOIS Code', 'Readable Name', 'Category', 'Description', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                </tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {entries.length === 0 ? 'No entries yet. Click "Load Built-in Codes" to populate.' : 'No matching codes.'}
                </td></tr>
              ) : (
                filtered.map(entry => (
                  <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm text-primary font-semibold">{entry.code}</td>
                    <td className="px-4 py-3 text-foreground font-medium">{entry.readable_name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${catColors[entry.category] || catColors.Other}`}>
                        {entry.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{entry.description || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEdit(entry)} className="text-muted-foreground hover:text-primary transition-colors p-1">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(entry)} className="text-muted-foreground hover:text-red-400 transition-colors p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
          {filtered.length} of {entries.length} entries
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, AlertTriangle, Copy, ArrowDownToLine, ArrowUpFromLine, Clock, Trash2, CheckCheck, ChevronDown } from 'lucide-react';
import { getDivisionName, getStationName, getCommodityName } from '@/utils/railwayDictionary';

const TYPE_CONFIG = {
  MissingODR:   { icon: AlertTriangle,   color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'Missing ODR' },
  DuplicateODR: { icon: Copy,            color: 'text-orange-400',  bg: 'bg-orange-500/10',  label: 'Duplicate ODR' },
  Arrival:      { icon: ArrowDownToLine, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Arrival' },
  Departure:    { icon: ArrowUpFromLine, color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Departure' },
  Delay:        { icon: Clock,           color: 'text-amber-400',   bg: 'bg-amber-500/10',   label: 'Delay' },
  Inward:       { icon: ArrowDownToLine, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Inward' },
  Outward:      { icon: ArrowUpFromLine, color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Outward' },
  System:       { icon: Bell,            color: 'text-primary',     bg: 'bg-primary/10',     label: 'System' },
};

// Notification types that correspond to inward or outward movement
const INWARD_TYPES  = ['Inward', 'Arrival'];
const OUTWARD_TYPES = ['Outward', 'Departure'];

export default function Notifications() {
  const [notifs, setNotifs] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  // Checkbox filters
  const [showInward, setShowInward]   = useState(true);
  const [showOutward, setShowOutward] = useState(true);
  const [showOther, setShowOther]     = useState(true);

  // Dropdown filters
  const [filterDivision, setFilterDivision]       = useState('All');
  const [selectedInwardStations, setSelectedInwardStations] = useState([]);
  const [selectedOutwardStations, setSelectedOutwardStations] = useState([]);
  const [filterCommGroup, setFilterCommGroup]     = useState('All');
  const [filterComm, setFilterComm]             = useState('All');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [notifData, movData] = await Promise.all([
      base44.entities.RailNotification.list('-created_date', 200),
      base44.entities.FreightMovement.list('-created_date', 1000),
    ]);
    setNotifs(notifData);
    setMovements(movData);
    setLoading(false);
  };

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.is_read);
    await Promise.all(unread.map(n => base44.entities.RailNotification.update(n.id, { is_read: true })));
    loadData();
  };

  const markRead = async (n) => {
    if (n.is_read) return;
    await base44.entities.RailNotification.update(n.id, { is_read: true });
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
  };

  const deleteNotif = async (n) => {
    await base44.entities.RailNotification.delete(n.id);
    setNotifs(prev => prev.filter(x => x.id !== n.id));
  };

  // Derive station lists from actual movement data
  const inwardStations  = ['All', ...new Set(movements.filter(r => r.movement_type === 'Inward').map(r => r.station_to).filter(Boolean)).values()].sort();
  const outwardStations = ['All', ...new Set(movements.filter(r => r.movement_type === 'Outward').map(r => r.station_from).filter(Boolean)).values()].sort();
  const divisions       = ['All', ...new Set(notifs.map(n => n.related_division).filter(Boolean)).values()].sort();

  const commodityGroups = ['All', ...new Set(movements.map(m => m.commodity_group || 'General/Other').filter(Boolean))].sort();
  const commodities = ['All', ...new Set(
    movements
      .filter(m => filterCommGroup === 'All' || (m.commodity_group || 'General/Other') === filterCommGroup)
      .map(m => m.commodity)
      .filter(Boolean)
  )].sort();

  const isInwardType  = (type) => INWARD_TYPES.includes(type);
  const isOutwardType = (type) => OUTWARD_TYPES.includes(type);

  const filtered = notifs.filter(n => {
    // Checkbox filter
    if (isInwardType(n.type)  && !showInward)  return false;
    if (isOutwardType(n.type) && !showOutward) return false;
    if (!isInwardType(n.type) && !isOutwardType(n.type) && !showOther) return false;

    // Division filter
    if (filterDivision !== 'All' && n.related_division !== filterDivision) return false;

    // Station filters — match against the ODR number in the notification
    if (isInwardType(n.type)) {
      if (selectedInwardStations.length > 0) {
        const relatedMovement = movements.find(m => m.odr_number === n.related_odr && m.movement_type === 'Inward');
        if (!relatedMovement || !selectedInwardStations.includes(relatedMovement.station_to)) return false;
      }
    } else if (isOutwardType(n.type)) {
      if (selectedOutwardStations.length > 0) {
        const relatedMovement = movements.find(m => m.odr_number === n.related_odr && m.movement_type === 'Outward');
        if (!relatedMovement || !selectedOutwardStations.includes(relatedMovement.station_from)) return false;
      }
    }

    // Commodity filters — match against related movement
    if (filterCommGroup !== 'All' || filterComm !== 'All') {
      const relatedMovement = movements.find(m => m.odr_number === n.related_odr);
      if (!relatedMovement) return false;
      if (filterCommGroup !== 'All' && (relatedMovement.commodity_group || 'General/Other') !== filterCommGroup) return false;
      if (filterComm !== 'All' && relatedMovement.commodity !== filterComm) return false;
    }

    return true;
  });

  const unreadCount = notifs.filter(n => !n.is_read).length;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-destructive text-white text-xs font-bold">{unreadCount}</span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">Alerts, ODR comparisons, and system events</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </button>
        )}
      </div>

      {/* Filters Panel */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        {/* Row 1: Checkboxes */}
        <div className="flex flex-wrap items-center gap-6">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Show</span>
          <CheckboxFilter
            checked={showInward}
            onChange={setShowInward}
            label="Inward / Arrival"
            color="text-emerald-600"
            bgColor="bg-emerald-500/10"
            borderColor="border-emerald-500/30"
          />
          <CheckboxFilter
            checked={showOutward}
            onChange={setShowOutward}
            label="Outward / Departure"
            color="text-blue-600"
            bgColor="bg-blue-500/10"
            borderColor="border-blue-500/30"
          />
          <CheckboxFilter
            checked={showOther}
            onChange={setShowOther}
            label="System / ODR Alerts"
            color="text-amber-600"
            bgColor="bg-amber-500/10"
            borderColor="border-amber-500/30"
          />
        </div>

        {/* Row 2: Dropdowns */}
        <div className="flex flex-wrap gap-3">
          <DropdownFilter
            value={filterDivision}
            onChange={v => setFilterDivision(v)}
            options={divisions}
            placeholder="All Divisions"
            renderOption={d => d === 'All' ? 'All Divisions' : `${getDivisionName(d)} (${d})`}
          />
          {showInward && (
            <MultiStationSelect
              label="Inward Stations"
              stations={inwardStations}
              selected={selectedInwardStations}
              onChange={setSelectedInwardStations}
            />
          )}
          {showOutward && (
            <MultiStationSelect
              label="Outward Stations"
              stations={outwardStations}
              selected={selectedOutwardStations}
              onChange={setSelectedOutwardStations}
            />
          )}

          <select
            value={filterCommGroup}
            onChange={e => { setFilterCommGroup(e.target.value); setFilterComm('All'); }}
            className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-primary/50 transition-colors"
          >
            <option value="All">All Commodity Groups</option>
            {commodityGroups.filter(cg => cg !== 'All').map(cg => <option key={cg} value={cg}>{cg}</option>)}
          </select>

          <select
            value={filterComm}
            onChange={e => setFilterComm(e.target.value)}
            className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-primary/50 transition-colors"
          >
            <option value="All">All Commodities</option>
            {commodities.filter(c => c !== 'All').map(c => <option key={c} value={c}>{getCommodityName(c)} ({c})</option>)}
          </select>

          {(filterDivision !== 'All' || selectedInwardStations.length > 0 || selectedOutwardStations.length > 0 || filterCommGroup !== 'All' || filterComm !== 'All') && (
            <button
              onClick={() => { setFilterDivision('All'); setSelectedInwardStations([]); setSelectedOutwardStations([]); setFilterCommGroup('All'); setFilterComm('All'); }}
              className="px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          )}
        </div>

        {(selectedInwardStations.length > 0 || selectedOutwardStations.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 p-2.5 rounded-lg border border-border mt-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">Active Stations:</span>
            {selectedInwardStations.map(s => (
              <span key={`in-${s}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 font-medium">
                To: {getStationName(s)} ({s})
                <button onClick={() => setSelectedInwardStations(selectedInwardStations.filter(x => x !== s))} className="hover:text-destructive font-bold ml-0.5">&times;</button>
              </span>
            ))}
            {selectedOutwardStations.map(s => (
              <span key={`out-${s}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600 font-medium">
                From: {getStationName(s)} ({s})
                <button onClick={() => setSelectedOutwardStations(selectedOutwardStations.filter(x => x !== s))} className="hover:text-destructive font-bold ml-0.5">&times;</button>
              </span>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {notifs.length} notifications
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No notifications match your filters</p>
            <p className="text-xs mt-1">Try adjusting the checkboxes or dropdowns above</p>
          </div>
        ) : (
          filtered.map(n => {
            const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.System;
            const IconComp = config.icon;
            return (
              <div
                key={n.id}
                onClick={() => markRead(n)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                  !n.is_read
                    ? 'border-primary/20 bg-primary/5 hover:bg-primary/10'
                    : 'border-border bg-card hover:bg-muted/30'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <IconComp className={`w-4 h-4 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{n.title}</span>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${
                      n.severity === 'error'   ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      n.severity === 'warning' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                      'bg-muted text-muted-foreground border-border'
                    }`}>{n.severity || 'info'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {n.related_division && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded border border-border text-muted-foreground">
                        {getDivisionName(n.related_division)} ({n.related_division})
                      </span>
                    )}
                    {n.related_odr && <span className="text-xs text-muted-foreground font-mono">{n.related_odr}</span>}
                    {n.created_date && <span className="text-xs text-muted-foreground">{new Date(n.created_date).toLocaleString('en-IN')}</span>}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteNotif(n); }}
                  className="text-muted-foreground hover:text-red-400 transition-colors p-1 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CheckboxFilter({ checked, onChange, label, color, bgColor, borderColor }) {
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all select-none ${
      checked ? `${bgColor} ${borderColor}` : 'bg-muted border-border opacity-50'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-current cursor-pointer"
      />
      <span className={`text-xs font-medium ${checked ? color : 'text-muted-foreground'}`}>{label}</span>
    </label>
  );
}

function DropdownFilter({ value, onChange, options, renderOption }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 pr-8 outline-none cursor-pointer hover:border-primary/50 transition-colors"
      >
        {options.map(o => <option key={o} value={o}>{renderOption(o)}</option>)}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

function MultiStationSelect({ label, stations, selected, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredStations = stations.filter(
    (s) =>
      s === "All" ||
      s.toLowerCase().includes(search.toLowerCase()) ||
      getStationName(s).toLowerCase().includes(search.toLowerCase())
  );

  const toggleStation = (station) => {
    if (station === "All") {
      onChange([]);
      return;
    }
    if (selected.includes(station)) {
      onChange(selected.filter((x) => x !== station));
    } else {
      onChange([...selected, station]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 pr-8 outline-none w-48 text-left flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors"
      >
        <span className="truncate">
          {selected.length === 0
            ? label
            : `${selected.length} Station(s)`}
        </span>
        <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl p-3 space-y-2">
          <input
            type="text"
            placeholder="Search stations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background border border-border text-foreground text-xs rounded px-2 py-1.5 outline-none focus:border-primary"
          />
          <div className="flex justify-between text-[10px] text-primary font-bold px-1 pb-1 border-b border-border/40">
            <button
              type="button"
              onClick={() => onChange([])}
              className="hover:underline cursor-pointer"
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={() => onChange(stations.filter((s) => s !== "All"))}
              className="hover:underline cursor-pointer"
            >
              Select All
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredStations.map((s) => {
              if (s === "All") return null;
              const isChecked = selected.includes(s);
              return (
                <label
                  key={s}
                  className="flex items-center gap-2 px-1.5 py-1 hover:bg-muted/50 rounded cursor-pointer text-xs select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleStation(s)}
                    className="rounded text-primary focus:ring-0 accent-primary cursor-pointer w-3.5 h-3.5"
                  />
                  <span className="truncate text-foreground">
                    {getStationName(s)} ({s})
                  </span>
                </label>
              );
            })}
            {filteredStations.length === 0 && (
              <div className="text-[10px] text-muted-foreground text-center py-2">
                No stations match search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
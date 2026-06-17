import { useEffect, useState, useRef } from "react";
import { Bell, Save, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { getStationName, getCommodityName } from "@/utils/railwayDictionary";

const OPTIONS = [
  ["inward_enabled", "Inward Notifications"],
  ["outward_enabled", "Outward Notifications"],
];

const DEFAULTS = {
  ...Object.fromEntries(OPTIONS.map(([key]) => [key, true])),
  stations: [],
  commodities: [],
  rakeCmdts: [],
};

// NOTE: rebuilt to reuse the same Station/Commodity selectors UI and cascade behavior as Notifications.jsx
// while keeping the existing persistence mechanism (UserNotificationPreference).

export default function NotificationPreferences() {
  const { user } = useAuth();

  const [recordId, setRecordId] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const [movements, setMovements] = useState([]);
  const [loadingMovements, setLoadingMovements] = useState(true);

  useEffect(() => {
    const load = async () => {
      const rows = await base44.entities.UserNotificationPreference.filter({
        user_id: user?.id,
      });
      const existing = rows[0];
      if (!existing) return;

      setRecordId(existing.id);
      setPrefs({
        ...DEFAULTS,
        ...existing,
        stations: existing.stations || [],
        commodities: existing.commodities || [],
        rakeCmdts: existing.rakeCmdts || [],
      });
    };

    if (user?.id) load().catch(console.error);
  }, [user?.id]);

  useEffect(() => {
    const fetchMovements = async () => {
      try {
        const movData = await base44.entities.FreightMovement.list(
          "-created_date",
          1000
        );
        setMovements(movData);
      } catch (err) {
        console.error("Failed to load movements", err);
      } finally {
        setLoadingMovements(false);
      }
    };

    fetchMovements();
  }, []);

  const save = async () => {
    setSaving(true);
    const payload = { ...prefs, user_id: user.id };
    try {
      const saved = recordId
        ? await base44.entities.UserNotificationPreference.update(
            recordId,
            payload
          )
        : await base44.entities.UserNotificationPreference.create(payload);
      setRecordId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  // Derive station lists from actual movement data (same as Notifications.jsx behavior)
  const inwardStations = [
    "All",
    ...new Set(
      movements
        .filter((r) => r.movement_type === "Inward")
        .map((r) => r.station_to)
        .filter(Boolean)
    ).values(),
  ].sort();
  const outwardStations = [
    "All",
    ...new Set(
      movements
        .filter((r) => r.movement_type === "Outward")
        .map((r) => r.station_from)
        .filter(Boolean)
    ).values(),
  ].sort();

  // For preferences we reuse the station selector logic as one combined list
  const stationOptions = [
    "All",
    ...new Set(
      [...inwardStations, ...outwardStations].filter((s) => s !== "All")
    ),
  ].sort();

  const commodities = [
    "All",
    ...new Set(movements.map((m) => m.product).filter(Boolean)),
  ].sort();

  const rakeCmdts = [
    "All",
    ...new Set(movements.map((m) => m.rake_cmdt).filter(Boolean)),
  ].sort();

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Notification Preferences
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose which freight alerts appear in your panel.
            </p>
          </div>
        </div>

        <button
          id="notification-prefs-save-btn"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving" : "Save"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {OPTIONS.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <span className="text-sm font-medium text-foreground">{label}</span>
            <input
              id={`toggle-${key}`}
              type="checkbox"
              checked={!!prefs[key]}
              onChange={(e) =>
                setPrefs((prev) => ({ ...prev, [key]: e.target.checked }))
              }
              className="h-4 w-4 accent-primary"
            />
          </label>
        ))}
      </div>

      <hr className="border-border" />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Filter Preferences
          </h2>
          <p className="text-xs text-muted-foreground">
            Restrict notifications to specific stations and commodities.
          </p>
        </div>

        {loadingMovements ? (
          <div className="h-24 bg-muted rounded-xl animate-pulse flex items-center justify-center text-sm text-muted-foreground">
            Loading filters data...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <MultiStationSelect
                label="Stations"
                stations={stationOptions}
                selected={prefs.stations || []}
                onChange={(vals) =>
                  setPrefs((prev) => ({ ...prev, stations: vals }))
                }
              />

              <select
                value={
                  prefs.commodities && prefs.commodities.length === 1
                    ? prefs.commodities[0]
                    : "All"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setPrefs((prev) => ({
                    ...prev,
                    commodities: v === "All" ? [] : [v],
                  }));
                }}
                className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-primary/50 transition-colors"
              >
                <option value="All">All Commodities</option>
                {commodities
                  .filter((c) => c !== "All")
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>

              <select
                value={
                  prefs.rakeCmdts && prefs.rakeCmdts.length === 1
                    ? prefs.rakeCmdts[0]
                    : "All"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setPrefs((prev) => ({
                    ...prev,
                    rakeCmdts: v === "All" ? [] : [v],
                  }));
                }}
                className="appearance-none bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-primary/50 transition-colors"
              >
                <option value="All">All Rake CMDT</option>
                {rakeCmdts
                  .filter((c) => c !== "All")
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </div>

            <button
              id="pref-clear-all-filters-btn"
              onClick={() =>
                setPrefs((prev) => ({
                  ...prev,
                  stations: [],
                  commodities: [],
                  rakeCmdts: [],
                }))
              }
              className="px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiStationSelect({ label, stations, selected, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      const target = event.target;
      if (
        containerRef.current &&
        dropdownRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current.contains(target)
      ) {
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
          {selected.length === 0 ? label : `${selected.length} Station(s)`}
        </span>
        <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute left-0 top-full z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-xl p-3 space-y-2 max-h-[300px] overflow-y-auto"
        >
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
          <div className="space-y-1">
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

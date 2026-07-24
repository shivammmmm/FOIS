import { useEffect, useMemo, useState } from "react";
import { Bell, Save, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import { buildFilterHierarchyOptions } from "@/utils/filterHierarchy";

const CHANNEL_OPTIONS = [
  ["in_app_enabled", "In App"],
  ["email_enabled", "Email"],
  ["whatsapp_enabled", "WhatsApp"],
];

const MOVEMENT_OPTIONS = [
  ["inward_enabled", "Inward"],
  ["outward_enabled", "Outward"],
];

const DEFAULTS = {
  in_app_enabled: true,
  email_enabled: false,
  whatsapp_enabled: false,
  inward_enabled: true,
  outward_enabled: true,
  stations: [],
  zones: [],
  divisions: [],
  states: [],
  districts: [],
  commodities: [],
  rakeCmdts: [],
};

export default function NotificationPreferences() {
  const { user } = useAuth();
  const [recordId, setRecordId] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [hierarchy, setHierarchy] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;

      try {
        const [prefsResult, hierarchyResult] = await Promise.allSettled([
          base44.entities.UserNotificationPreference.filter({ user_id: user.id }),
          base44.filterHierarchy(),
        ]);

        const errors = [];
        if (hierarchyResult.status === "rejected") errors.push("Master/report data load failed");
        setLoadErrors(errors);
        setHierarchy(hierarchyResult.status === "fulfilled" ? hierarchyResult.value : {});

        const rows = prefsResult.status === "fulfilled" ? prefsResult.value : [];
        const existing = rows?.[0];
        if (existing) {
          setRecordId(existing.id);
          setPrefs(toPreferenceState(existing));
          setLastUpdated(existing.updated_date || existing.updated_at || existing.created_date);
        }
      } catch (error) {
        console.error("[NotificationPreferences] load failed:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id]);

  // Master data if it exists for a code, otherwise fall back to the raw code/name
  // as it appears in FOIS Report data (see buildFilterHierarchyOptions / filterHierarchy()).
  const options = useMemo(
    () =>
      buildFilterHierarchyOptions(hierarchy || {}, {
        zone: prefs.zones,
        division: prefs.divisions,
        state: prefs.states,
        district: prefs.districts,
        commodity: prefs.commodities,
      }),
    [hierarchy, prefs.zones, prefs.divisions, prefs.states, prefs.districts, prefs.commodities]
  );

  async function save() {
    if (!user?.id) return;
    setSaving(true);
    const payload = toPreferencePayload(prefs, user.id);
    try {
      const saved = recordId
        ? await base44.entities.UserNotificationPreference.update(recordId, payload)
        : await base44.entities.UserNotificationPreference.create(payload);
      setRecordId(saved.id);
      setLastUpdated(saved.updated_date || saved.updated_at || new Date().toISOString());
    } finally {
      setSaving(false);
    }
  }

  const setPref = (key, value) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Notification Settings</h1>
            <p className="text-sm text-muted-foreground">
              Save stations, commodities, rake CMDT and delivery channels.
            </p>
          </div>
        </div>

        <button
          id="notification-prefs-save-btn"
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving" : "Save Settings"}
        </button>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0"><div className={`font-semibold ${prefs.in_app_enabled || prefs.email_enabled || prefs.whatsapp_enabled ? 'text-emerald-500' : 'text-muted-foreground'}`}>{prefs.in_app_enabled || prefs.email_enabled || prefs.whatsapp_enabled ? 'Active' : 'Disabled'}</div><div className="mt-1 break-words text-xs text-muted-foreground">Channels: {[prefs.in_app_enabled && 'In-App', prefs.email_enabled && 'Email', prefs.whatsapp_enabled && 'WhatsApp'].filter(Boolean).join(', ') || 'None'} · Movement: {[prefs.inward_enabled && 'Inward', prefs.outward_enabled && 'Outward'].filter(Boolean).join(', ') || 'None'} · State: {prefs.states.join(', ') || 'All'} · District: {prefs.districts.join(', ') || 'All'} · Station: {prefs.stations.join(', ') || 'All'} · Commodity: {prefs.commodities.join(', ') || 'All'} · Rake CMDT: {prefs.rakeCmdts.join(', ') || 'All'} · Last Updated: {lastUpdated ? new Date(lastUpdated).toLocaleString('en-IN') : '-'}</div></div>
        <div className="flex gap-2"><button type="button" onClick={() => setPrefs((prev) => ({ ...prev, in_app_enabled: !(prev.in_app_enabled || prev.email_enabled || prev.whatsapp_enabled), email_enabled: false, whatsapp_enabled: false }))} className="rounded-lg border border-border px-3 py-2 text-xs">{prefs.in_app_enabled || prefs.email_enabled || prefs.whatsapp_enabled ? 'Disable' : 'Enable'}</button>{recordId && <button type="button" onClick={async () => { if (!window.confirm('Delete notification settings?')) return; await base44.entities.UserNotificationPreference.delete(recordId); setRecordId(null); setPrefs(DEFAULTS); setLastUpdated(null); }} className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5" />Delete Settings</button>}</div>
      </section>

      <section className="space-y-4 overflow-visible">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Channels
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {CHANNEL_OPTIONS.map(([key, label]) => (
            <ToggleRow key={key} label={label} checked={!!prefs[key]} onChange={(value) => setPref(key, value)} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Movement Flow
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {MOVEMENT_OPTIONS.map(([key, label]) => (
            <ToggleRow key={key} label={label} checked={!!prefs[key]} onChange={(value) => setPref(key, value)} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Filters
        </h2>

        {loading ? (
          <div className="flex h-24 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground animate-pulse">
            Loading preference data...
          </div>
        ) : (
          <div className="space-y-4">
            {loadErrors.length > 0 && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loadErrors.join(" · ")}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MultiSelectFilter label="Zone" selected={prefs.zones} onChange={(value) => setPrefs((prev) => ({ ...prev, zones: value, divisions: [], stations: [] }))} options={options.zones} placeholder="All Zones" />
              <MultiSelectFilter label="Division" selected={prefs.divisions} onChange={(value) => setPrefs((prev) => ({ ...prev, divisions: value, stations: [] }))} options={options.divisions} placeholder="All Divisions" />
              <MultiSelectFilter label="State" selected={prefs.states} onChange={(value) => setPrefs((prev) => ({ ...prev, states: value, districts: [], stations: [] }))} options={options.states} placeholder="All States" />
              <MultiSelectFilter label="District" selected={prefs.districts} onChange={(value) => setPrefs((prev) => ({ ...prev, districts: value, stations: [] }))} options={options.districts} placeholder={prefs.states.length ? "All Districts" : "Select State first"} disabled={!prefs.states.length} />
              <MultiSelectFilter label="Station" selected={prefs.stations} onChange={(value) => setPref("stations", value)} options={options.stations} placeholder="All Stations" />
              <MultiSelectFilter
                label="Commodity"
                selected={prefs.commodities}
                onChange={(value) =>
                  setPrefs((prev) => ({ ...prev, commodities: value, rakeCmdts: [] }))
                }
                options={options.commodities}
                placeholder="All Commodities"
              />
              <MultiSelectFilter
                label="Rake CMDT"
                selected={prefs.rakeCmdts}
                onChange={(value) => setPrefs((prev) => ({ ...prev, rakeCmdts: value }))}
                options={options.rakeCmdts}
                placeholder="All Rake CMDT"
              />
            </div>

            <button
              id="pref-clear-all-filters-btn"
              type="button"
              onClick={() =>
                setPrefs((prev) => ({
                  ...prev,
                  stations: [],
                  zones: [],
                  divisions: [],
                  states: [],
                  districts: [],
                  commodities: [],
                  rakeCmdts: [],
                }))
              }
              className="rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              Clear Filter
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

function toPreferenceState(existing = {}) {
  return {
    ...DEFAULTS,
    in_app_enabled: existing.in_app_enabled !== false,
    email_enabled: existing.email_enabled === true,
    whatsapp_enabled: existing.whatsapp_enabled === true,
    inward_enabled: existing.inward_enabled !== false,
    outward_enabled: existing.outward_enabled !== false,
    stations: existing.stations || [],
    zones: existing.zones || [],
    divisions: existing.divisions || [],
    states: existing.states || [],
    districts: existing.districts || [],
    commodities: existing.commodities || [],
    rakeCmdts: existing.rakeCmdts || [],
  };
}

function toPreferencePayload(prefs, userId) {
  return {
    user_id: userId,
    in_app_enabled: prefs.in_app_enabled,
    email_enabled: prefs.email_enabled,
    whatsapp_enabled: prefs.whatsapp_enabled,
    inward_enabled: prefs.inward_enabled,
    outward_enabled: prefs.outward_enabled,
    stations: prefs.stations || [],
    zones: prefs.zones || [],
    divisions: prefs.divisions || [],
    states: prefs.states || [],
    districts: prefs.districts || [],
    commodities: prefs.commodities || [],
    rakeCmdts: prefs.rakeCmdts || [],
  };
}

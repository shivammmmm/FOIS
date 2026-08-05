import { useEffect, useMemo, useState } from "react";
import { Bell, Eye, Plus, Save, Trash2, X, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import { buildFilterHierarchyOptions } from "@/utils/filterHierarchy";

const STAGE_OPTIONS = [
  ["notify_new_demand", "📝 New Rack Indent"],
  ["notify_supplied", "🚚 Rack Supplied"],
  ["notify_dispatched", "🚆 Rack Dispatched"],
];

const DEFAULTS = {
  preset_name: "",
  in_app_enabled: true,
  email_enabled: true,
  inward_enabled: true,
  outward_enabled: true,
  notify_new_demand: true,
  notify_supplied: true,
  notify_dispatched: true,
  stations: [],
  zones: [],
  divisions: [],
  states: [],
  districts: [],
  commodities: [],
  rakeCmdts: [],
  cnsr: [],
  cnsg: [],
};

export default function NotificationPreferences() {
  const { user } = useAuth();
  const [allPresets, setAllPresets] = useState([]);
  const [editingPreset, setEditingPreset] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [hierarchy, setHierarchy] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inspectPreset, setInspectPreset] = useState(null);

  useEffect(() => {
    loadData();
  }, [user?.id]);

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
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
      setAllPresets(rows);
    } catch (error) {
      console.error("[NotificationPreferences] load failed:", error);
    } finally {
      setLoading(false);
    }
  };

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

  const generateNextPresetCode = () => {
    const existingNums = allPresets
      .map((p) => p.preset_code || p.data?.preset_code)
      .filter((c) => c && /^ALERT-\d+$/.test(c))
      .map((c) => parseInt(c.replace("ALERT-", ""), 10));
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    return `ALERT-${String(nextNum).padStart(2, "0")}`;
  };

  async function save() {
    if (!user?.id) return;
    setSaving(true);
    const code = editingPreset?.preset_code || generateNextPresetCode();
    const payload = {
      user_id: user.id,
      preset_code: code,
      preset_name: prefs.preset_name || `Alert Rule (${code})`,
      in_app_enabled: true,
      email_enabled: true,
      inward_enabled: true,
      outward_enabled: true,
      notify_new_demand: prefs.notify_new_demand !== false,
      notify_supplied: prefs.notify_supplied !== false,
      notify_dispatched: prefs.notify_dispatched !== false,
      stations: prefs.stations || [],
      zones: prefs.zones || [],
      divisions: prefs.divisions || [],
      states: prefs.states || [],
      districts: prefs.districts || [],
      commodities: prefs.commodities || [],
      rakeCmdts: prefs.rakeCmdts || [],
      cnsr: prefs.cnsr || [],
      cnsg: prefs.cnsg || [],
    };

    try {
      if (editingPreset?.id) {
        await base44.entities.UserNotificationPreference.update(editingPreset.id, payload);
      } else {
        await base44.entities.UserNotificationPreference.create(payload);
      }
      setPrefs(DEFAULTS);
      setEditingPreset(null);
      await loadData();
    } catch (err) {
      console.error("[NotificationPreferences] save error:", err);
    } finally {
      setSaving(false);
    }
  }

  const startEdit = (preset) => {
    setEditingPreset(preset);
    setPrefs({
      ...DEFAULTS,
      preset_name: preset.preset_name || "",
      stations: preset.stations || preset.data?.stations || [],
      zones: preset.zones || preset.data?.zones || [],
      divisions: preset.divisions || preset.data?.divisions || [],
      states: preset.states || preset.data?.states || [],
      districts: preset.districts || preset.data?.districts || [],
      commodities: preset.commodities || preset.data?.commodities || [],
      rakeCmdts: preset.rakeCmdts || preset.data?.rakeCmdts || [],
      cnsr: preset.cnsr || preset.data?.cnsr || [],
      cnsg: preset.cnsg || preset.data?.cnsg || [],
      notify_new_demand: preset.notify_new_demand !== false,
      notify_supplied: preset.notify_supplied !== false,
      notify_dispatched: preset.notify_dispatched !== false,
    });
  };

  const deletePreset = async (id) => {
    if (!window.confirm("Delete this notification alert rule?")) return;
    try {
      await base44.entities.UserNotificationPreference.delete(id);
      if (editingPreset?.id === id) {
        setEditingPreset(null);
        setPrefs(DEFAULTS);
      }
      await loadData();
    } catch (err) {
      console.error("[NotificationPreferences] delete error:", err);
    }
  };

  const setPref = (key, value) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Notification Settings & Alert Rules</h1>
            <p className="text-sm text-muted-foreground">
              Create multiple notification filter presets. In-App & Email alerts are active by default.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {editingPreset && (
            <button
              type="button"
              onClick={() => {
                setEditingPreset(null);
                setPrefs(DEFAULTS);
              }}
              className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel Edit
            </button>
          )}
          <button
            id="notification-prefs-save-btn"
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
          >
            {editingPreset ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {saving ? "Saving..." : editingPreset ? "Update Rule" : "Create Alert Rule"}
          </button>
        </div>
      </div>

      {/* Saved Rule Presets List */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Active Alert Rules ({allPresets.length})
        </h2>
        {loading ? (
          <div className="flex h-16 items-center justify-center rounded-xl bg-card border text-xs text-muted-foreground animate-pulse">
            Loading active rules...
          </div>
        ) : allPresets.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No notification alert rules configured yet. Create a rule below to start receiving tailored alerts.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allPresets.map((preset) => {
              const code = preset.preset_code || preset.data?.preset_code || `ALERT-01`;
              const name = preset.preset_name || preset.data?.preset_name || `Alert Rule (${code})`;
              return (
                <div
                  key={preset.id}
                  className={`group relative flex flex-col justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 shadow-xs ${
                    editingPreset?.id === preset.id ? "border-primary ring-2 ring-primary/20" : "border-border"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setInspectPreset(preset)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                        title="Click to view rule filter details"
                      >
                        <span>{code}</span>
                        <Eye className="h-3 w-3 opacity-75" />
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(preset)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                          title="Edit rule"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(preset.id)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                          title="Delete rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="font-semibold text-sm text-foreground">{name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      Zones: {(preset.zones || preset.data?.zones || []).join(", ") || "All"} · 
                      Stations: {(preset.stations || preset.data?.stations || []).join(", ") || "All"} · 
                      CMDT: {(preset.commodities || preset.data?.commodities || []).join(", ") || "All"}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                    <span className="text-emerald-500 font-semibold">● In-App & Email ON</span>
                    <span>Click code to inspect</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rule Creator / Editor Form */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {editingPreset ? `Edit Alert Rule (${editingPreset.preset_code || 'ALERT'})` : "Create New Alert Rule"}
          </h2>
          <span className="text-xs text-muted-foreground">
            Auto-assigned Code: <strong className="font-mono text-primary">{editingPreset?.preset_code || generateNextPresetCode()}</strong>
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Rule Name / Alias</label>
            <input
              type="text"
              value={prefs.preset_name}
              onChange={(e) => setPref("preset_name", e.target.value)}
              placeholder={`e.g. Steel & Cement Alert (${editingPreset?.preset_code || generateNextPresetCode()})`}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Active Channels</label>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-emerald-500">
              ✓ In-App Notification (Enabled) · ✓ Email Notification (Enabled)
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notification Trigger Stages
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            {STAGE_OPTIONS.map(([key, label]) => (
              <ToggleRow key={key} label={label} checked={!!prefs[key]} onChange={(value) => setPref(key, value)} />
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Filter Rules Criteria
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MultiSelectFilter label="Zone" selected={prefs.zones} onChange={(value) => setPrefs((prev) => ({ ...prev, zones: value, divisions: [], stations: [] }))} options={options.zones} placeholder="All Zones" />
            <MultiSelectFilter label="Division" selected={prefs.divisions} onChange={(value) => setPrefs((prev) => ({ ...prev, divisions: value, stations: [] }))} options={options.divisions} placeholder="All Divisions" />
            <MultiSelectFilter label="State" selected={prefs.states} onChange={(value) => setPrefs((prev) => ({ ...prev, states: value, districts: [], stations: [] }))} options={options.states} placeholder="All States" />
            <MultiSelectFilter label="District" selected={prefs.districts} onChange={(value) => setPrefs((prev) => ({ ...prev, districts: value, stations: [] }))} options={options.districts} placeholder={prefs.states.length ? "All Districts" : "Select State first"} disabled={!prefs.states.length} />
            <MultiSelectFilter label="Station" selected={prefs.stations} onChange={(value) => setPref("stations", value)} options={options.stations} placeholder="All Stations" />
            <MultiSelectFilter
              label="Commodity (CMDT)"
              selected={prefs.commodities}
              onChange={(value) => setPrefs((prev) => ({ ...prev, commodities: value, rakeCmdts: [] }))}
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
            <MultiSelectFilter
              label="Consignor (CNSR)"
              selected={prefs.cnsr}
              onChange={(value) => setPrefs((prev) => ({ ...prev, cnsr: value }))}
              options={options.consignor || []}
              placeholder="All Consignors"
            />
            <MultiSelectFilter
              label="Consignee / Company (CNSG)"
              selected={prefs.cnsg}
              onChange={(value) => setPrefs((prev) => ({ ...prev, cnsg: value }))}
              options={options.consignee || options.consignor || []}
              placeholder="All Consignees / Companies"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() =>
                setPrefs((prev) => ({
                  ...DEFAULTS,
                  preset_name: prev.preset_name,
                }))
              }
              className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
            >
              Clear Form Filters
            </button>
          </div>
        </div>
      </section>

      {/* Preset Inspection Modal */}
      {inspectPreset && (
        <PresetInspectionModal
          preset={inspectPreset}
          onClose={() => setInspectPreset(null)}
        />
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 cursor-pointer hover:bg-muted/30">
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

function PresetInspectionModal({ preset, onClose }) {
  const code = preset.preset_code || preset.data?.preset_code || "ALERT-01";
  const name = preset.preset_name || preset.data?.preset_name || `Alert Rule (${code})`;

  const details = [
    ["Unique Alert Code", code],
    ["Rule Alias Name", name],
    ["In-App Channel", "Active (Enabled)"],
    ["Email Channel", "Active (Enabled)"],
    ["Zones", (preset.zones || preset.data?.zones || []).join(", ") || "All Zones"],
    ["Divisions", (preset.divisions || preset.data?.divisions || []).join(", ") || "All Divisions"],
    ["Stations", (preset.stations || preset.data?.stations || []).join(", ") || "All Stations"],
    ["Commodity (CMDT)", (preset.commodities || preset.data?.commodities || []).join(", ") || "All Commodities"],
    ["Rake CMDT", (preset.rakeCmdts || preset.data?.rakeCmdts || []).join(", ") || "All Rake CMDT"],
    ["Consignor (CNSR)", (preset.cnsr || preset.data?.cnsr || []).join(", ") || "All Consignors"],
    ["Consignee / Company (CNSG)", (preset.cnsg || preset.data?.cnsg || []).join(", ") || "All Consignees"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              {code}
            </span>
            <h3 className="font-bold text-foreground">{name}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {details.map(([label, val]) => (
            <div key={label} className="flex justify-between items-start text-xs border-b border-border/40 py-2">
              <span className="font-medium text-muted-foreground">{label}</span>
              <span className="font-semibold text-foreground text-right max-w-[200px] break-words">{val}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
        >
          Close Inspection
        </button>
      </div>
    </div>
  );
}

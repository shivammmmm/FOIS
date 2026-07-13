import { useEffect, useMemo, useState } from "react";
import { Bell, Save, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { apiClient } from "@/api/apiClient";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import {
  getBusinessRakeCmdtCode as getRakeCmdtCode,
} from "@/utils/freightRecordFilters";
import { getDivisionName } from "@/utils/railwayDictionary";
import { getStationMeta } from "@/utils/stationMaster";

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
  const [movements, setMovements] = useState([]);
  const [stationsPool, setStationsPool] = useState([]);
  const [statesPool, setStatesPool] = useState([]);
  const [districtsPool, setDistrictsPool] = useState([]);
  const [divisionMasters, setDivisionMasters] = useState([]);
  const [commodityMasters, setCommodityMasters] = useState([]);
  const [rakeCmdtMasters, setRakeCmdtMasters] = useState([]);
  const [loadErrors, setLoadErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;

      try {
        const requests = [
          base44.entities.UserNotificationPreference.filter({ user_id: user.id }),
          base44.entities.FreightMovement.list("-created_date", 50000),
          apiClient.stationMaster.list({ limit: 50000 }),
          apiClient.readOnlyMasters.states(),
          apiClient.readOnlyMasters.districts(),
          apiClient.masterCatalog.list("division", { limit: 500 }),
          apiClient.masterCatalog.list("commodity", { limit: 500 }),
          apiClient.masterCatalog.list("rake-cmdt", { limit: 500 }),
        ];
        const results = await Promise.allSettled(requests);
        const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback;
        const errors = [];
        if (results[3].status === "rejected") errors.push("State load failed");
        if (results[4].status === "rejected") errors.push("District load failed");
        if (results[1].status === "rejected") errors.push("Freight option load failed");
        if (results[2].status === "rejected") errors.push("Station load failed");
        setLoadErrors(errors);
        const rows = value(0, []);
        const movData = value(1, []);
        const stationData = value(2, { items: [] });
        const stateData = value(3, []);
        const districtData = value(4, []);

        const existing = rows?.[0];
        if (existing) {
          setRecordId(existing.id);
          setPrefs(toPreferenceState(existing));
          setLastUpdated(existing.updated_date || existing.updated_at || existing.created_date);
        }

        setMovements(extractItems(movData));
        setStationsPool(extractItems(stationData));
        setStatesPool(extractItems(stateData));
        setDistrictsPool(extractItems(districtData));
        setDivisionMasters(extractItems(value(5, [])));
        setCommodityMasters(extractItems(value(6, [])));
        setRakeCmdtMasters(extractItems(value(7, [])));
      } catch (error) {
        console.error("[NotificationPreferences] load failed:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id]);

  const stationMetaByCode = useMemo(() => {
    const map = new Map();
    stationsPool.forEach((station) => {
      const code = station.station_code || station.code;
      if (!code) return;
      const state = resolveMasterCode(station.state, statesPool);
      const district = resolveDistrictCode(station.district, state, districtsPool);
      map.set(String(code).toUpperCase(), {
        zone: station.zone || "",
        state,
        district,
        name: station.station_name || station.name || code,
      });
    });
    return map;
  }, [districtsPool, statesPool, stationsPool]);

  const options = useMemo(() => {
    const zones = new Set();
    const divisions = new Map();
    const states = new Map(statesPool.filter((state) => state.active !== false).map((state) => [state.code, state.name]));
    const selectedStateCodes = new Set(prefs.states);
    const districts = new Map(districtsPool.filter((district) => district.active !== false && selectedStateCodes.has(district.parent_code)).map((district) => [district.code, district.name]));
    const stations = new Map();
    const commodities = new Map();
    const rakeCmdts = new Map();
    const divisionLabels = masterLabelMap(divisionMasters);
    const commodityLabels = masterLabelMap(commodityMasters);
    const rakeLabels = masterLabelMap(rakeCmdtMasters);

    const commodityScoped =
      prefs.commodities.length === 0
        ? movements
        : movements.filter((movement) => prefs.commodities.includes(getCommodityCode(movement)));

    movements.forEach((movement) => {
      const division = getDivisionCode(movement);
      if (division) divisions.set(division, formatMasterLabel(division, divisionLabels.get(division) || getDivisionName(division)));
      for (const station of getMovementStations(movement)) {
        const code = station.code;
        const masterMeta = getStationPreferenceMeta(code, stationMetaByCode);
        const meta = {
          ...masterMeta,
          state: resolveMasterCode(station.state || masterMeta.state, statesPool),
          district: resolveDistrictCode(station.district || masterMeta.district, resolveMasterCode(station.state || masterMeta.state, statesPool), districtsPool),
          zone: station.zone || masterMeta.zone,
        };
        if (prefs.states.length && !prefs.states.includes(meta.state)) continue;
        if (prefs.districts.length && !prefs.districts.includes(meta.district)) continue;
        stations.set(code, meta.name && meta.name !== code ? `${meta.name} (${code})` : code);
        if (meta.zone) zones.add(meta.zone);
      }

      const commodity = getCommodityCode(movement);
      if (commodity) commodities.set(commodity, formatMasterLabel(commodity, commodityLabels.get(commodity)));

    });

    commodityScoped.forEach((movement) => {
      const rakeCmdt = getRakeCmdtCode(movement);
      if (rakeCmdt) rakeCmdts.set(rakeCmdt, formatMasterLabel(rakeCmdt, rakeLabels.get(rakeCmdt)));
    });

    return {
      zones: [...zones].sort(),
      divisions: mapOptions(divisions),
      states: mapOptions(states),
      districts: mapOptions(districts),
      stations: mapOptions(stations),
      commodities: mapOptions(commodities),
      rakeCmdts: mapOptions(rakeCmdts),
    };
  }, [commodityMasters, districtsPool, divisionMasters, movements, prefs.commodities, prefs.districts, prefs.states, rakeCmdtMasters, statesPool, stationMetaByCode, stationsPool]);

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
              <MultiSelectFilter label="Zone" selected={prefs.zones} onChange={(value) => setPref("zones", value)} options={options.zones} placeholder="All Zones" />
              <MultiSelectFilter label="Division" selected={prefs.divisions} onChange={(value) => setPref("divisions", value)} options={options.divisions} placeholder="All Divisions" />
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

function getStationPreferenceMeta(code, stationMetaByCode) {
  const normalized = String(code || "").toUpperCase();
  const dbMeta = stationMetaByCode.get(normalized);
  const fallback = getStationMeta(code);
  return {
    name: dbMeta?.name || fallback?.name || normalized,
    zone: dbMeta?.zone || fallback?.zone || "",
    state: dbMeta?.state || fallback?.state || "",
    district: dbMeta?.district || fallback?.district || "",
  };
}

function getMovementStations(record) {
  const rows = [
    { code: record.station_from || readRaw(record, "STTN FROM"), state: record.from_state || readRaw(record, "State (Source)"), district: record.from_district || readRaw(record, "District (Source)"), zone: record.from_zone || record.zone },
    { code: record.station_to || readRaw(record, "DSTN"), state: record.to_state || readRaw(record, "State (To)"), district: record.to_district || readRaw(record, "District (To)"), zone: record.to_zone || record.zone },
  ];
  return rows
    .map((station) => ({ ...station, code: String(station.code || "").trim().toUpperCase() }))
    .filter((station) => station.code);
}

function resolveMasterCode(value, masters) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.toUpperCase();
  const match = masters.find((item) =>
    String(item.code || "").trim().toUpperCase() === normalized ||
    String(item.name || "").trim().toUpperCase() === normalized
  );
  return String(match?.code || raw).trim().toUpperCase();
}

function resolveDistrictCode(value, stateCode, districts) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.toUpperCase();
  const match = districts.find((item) => {
    const sameDistrict =
      String(item.code || "").trim().toUpperCase() === normalized ||
      String(item.name || "").trim().toUpperCase() === normalized;
    const sameState = !stateCode || String(item.parent_code || "").trim().toUpperCase() === stateCode;
    return sameDistrict && sameState;
  });
  return String(match?.code || raw).trim().toUpperCase();
}

function readRaw(record, ...keys) {
  const normalized = Object.fromEntries(Object.entries(record?.raw_data || {}).map(([key, value]) => [String(key).trim().toUpperCase(), value]));
  for (const key of keys) {
    const value = record?.raw_data?.[key] ?? record?.[key] ?? normalized[String(key).trim().toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function getCommodityCode(record) {
  return String(record.commodity || record.cmdt || readRaw(record, "CMDT", "cmdt", "Commodity") || record.commodity_code || "").trim();
}

function getDivisionCode(record) {
  return String(record.division || record.dvsn || readRaw(record, "DVSN", "division") || "").trim();
}

function extractItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function masterLabelMap(rows) {
  return new Map(rows.map((row) => [String(row.code || row.commodity_code || "").trim(), row.name || row.commodity_name || ""]).filter(([code]) => code));
}

function formatMasterLabel(code, name) {
  const raw = String(code || "").trim();
  const full = String(name || "").trim();
  return full && full.toUpperCase() !== raw.toUpperCase() ? `${full} (${raw})` : raw;
}

function mapOptions(map) {
  return [...map.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .map(([value, label]) => ({ value, label, searchText: `${label} ${value}` }));
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

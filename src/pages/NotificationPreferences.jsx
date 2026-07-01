import { useEffect, useMemo, useState } from "react";
import { Bell, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { apiClient } from "@/api/apiClient";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import {
  getBusinessRakeCmdtCode as getRakeCmdtCode,
  getBusinessRakeCmdtDisplay as getRakeCmdtDisplay,
} from "@/utils/freightRecordFilters";
import { formatStationNameAndCode, getStationMeta } from "@/utils/stationMaster";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;

      try {
        const [rows, movData, stationData] = await Promise.all([
          base44.entities.UserNotificationPreference.filter({ user_id: user.id }),
          base44.entities.FreightMovement.list("-created_date", 50000),
          apiClient.stationMaster.list({ limit: 50000 }),
        ]);

        const existing = rows?.[0];
        if (existing) {
          setRecordId(existing.id);
          setPrefs(toPreferenceState(existing));
        }

        setMovements(movData || []);
        setStationsPool(stationData?.items || []);
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
      map.set(String(code).toUpperCase(), {
        zone: station.zone || "",
        state: station.state || "",
        district: station.district || "",
        name: station.station_name || station.name || code,
      });
    });
    return map;
  }, [stationsPool]);

  const options = useMemo(() => {
    const zones = new Set();
    const states = new Set();
    const districts = new Set();
    const stations = new Map();
    const commodities = new Map();
    const rakeCmdts = new Map();

    const commodityScoped =
      prefs.commodities.length === 0
        ? movements
        : movements.filter((movement) => prefs.commodities.includes(getCommodityCode(movement)));

    movements.forEach((movement) => {
      for (const code of [movement.station_from, movement.station_to]) {
        if (!code) continue;
        const meta = getStationPreferenceMeta(code, stationMetaByCode);
        stations.set(code, meta.name && meta.name !== code ? `${meta.name} (${code})` : formatStationNameAndCode(code));
        if (meta.zone) zones.add(meta.zone);
        if (meta.state) states.add(meta.state);
        if (meta.district) districts.add(meta.district);
      }

      const commodity = getCommodityCode(movement);
      if (commodity) commodities.set(commodity, getCommodityDisplay(movement));

    });

    commodityScoped.forEach((movement) => {
      const rakeCmdt = getRakeCmdtCode(movement);
      if (rakeCmdt) rakeCmdts.set(rakeCmdt, getRakeCmdtDisplay(movement));
    });

    return {
      zones: [...zones].sort(),
      states: [...states].sort(),
      districts: [...districts].sort(),
      stations: mapOptions(stations),
      commodities: mapOptions(commodities),
      rakeCmdts: mapOptions(rakeCmdts),
    };
  }, [movements, prefs.commodities, stationMetaByCode]);

  async function save() {
    if (!user?.id) return;
    setSaving(true);
    const payload = toPreferencePayload(prefs, user.id);
    try {
      const saved = recordId
        ? await base44.entities.UserNotificationPreference.update(recordId, payload)
        : await base44.entities.UserNotificationPreference.create(payload);
      setRecordId(saved.id);
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
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
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
          {saving ? "Saving" : "Save Notification"}
        </button>
      </div>

      <section className="space-y-3">
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
            <div className="flex flex-wrap gap-2">
              <MultiSelectFilter label="Zone" selected={prefs.zones} onChange={(value) => setPref("zones", value)} options={options.zones} placeholder="All Zones" />
              <MultiSelectFilter label="State" selected={prefs.states} onChange={(value) => setPref("states", value)} options={options.states} placeholder="All States" />
              <MultiSelectFilter label="District" selected={prefs.districts} onChange={(value) => setPref("districts", value)} options={options.districts} placeholder="All Districts" />
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

function readRaw(record, ...keys) {
  for (const key of keys) {
    const value = record?.raw_data?.[key] ?? record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function getCommodityCode(record) {
  return String(record.commodity_code || record.commodity || readRaw(record, "CMDT", "Commodity") || "").trim();
}

function getCommodityDisplay(record) {
  return record.commodity_name || readRaw(record, "CMDT", "Commodity", "Commodity Name") || record.commodity || record.commodity_code || "";
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
    states: prefs.states || [],
    districts: prefs.districts || [],
    commodities: prefs.commodities || [],
    rakeCmdts: prefs.rakeCmdts || [],
  };
}

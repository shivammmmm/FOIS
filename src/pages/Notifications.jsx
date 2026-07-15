import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  CheckCheck,
  Save,
  Trash2,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import { getDivisionName } from "@/utils/railwayDictionary";
import {
  getBusinessRakeCmdtCode as getRakeCmdtCode,
  getBusinessRakeCmdtDisplay as getRakeCmdtDisplay,
} from "@/utils/freightRecordFilters";
import { formatStationNameAndCode, getStationMeta, registerStationMetaFromRecords } from "@/utils/stationMaster";
import {
  clearPersistentFilters,
  normalizeMultiValue,
  optionMatches,
  readPersistentFilters,
  writePersistentFilters,
} from "@/utils/persistentFilters";

const FILTER_SOURCE = "notifications";
const SAVED_SOURCE = "Notifications";

const TYPE_CONFIG = {
  Arrival: { icon: ArrowDownToLine, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Arrival" },
  Departure: { icon: ArrowUpFromLine, color: "text-blue-400", bg: "bg-blue-500/10", label: "Departure" },
  Inward: { icon: ArrowDownToLine, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Inward" },
  Outward: { icon: ArrowUpFromLine, color: "text-blue-400", bg: "bg-blue-500/10", label: "Outward" },
};

const INWARD_TYPES = ["Inward", "Arrival"];
const OUTWARD_TYPES = ["Outward", "Departure"];

const DEFAULT_FILTERS = {
  showInward: true,
  showOutward: true,
  divisions: [],
  states: [],
  districts: [],
  stations: [],
  commodities: [],
  rakeCmdts: [],
};

export default function Notifications() {
  const { user } = useAuth();
  const didLoadPersisted = useRef(false);
  const [notifs, setNotifs] = useState([]);
  const [movements, setMovements] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    loadData();
  }, [user?.id]);

  useEffect(() => {
    if (didLoadPersisted.current || !user?.id) return;
    didLoadPersisted.current = true;
    const persisted = readPersistentFilters(FILTER_SOURCE, user.id);
    if (persisted) applyFilterState(persisted);
  }, [user?.id]);

  async function loadData() {
    setLoading(true);
    try {
      const [notifData, movData, savedRows] = await Promise.all([
        base44.notifications.list(),
        base44.entities.FreightMovement.list("-created_date", 50000),
        user?.id
          ? base44.entities.SavedFilter.filter({ user_id: user.id }, "-created_at", 100)
          : Promise.resolve([]),
      ]);
      setNotifs(notifData || []);
      setMovements(movData || []);
      registerStationMetaFromRecords(movData || []);
      setSavedFilters((savedRows || []).filter((row) => row.source === SAVED_SOURCE));
    } catch (error) {
      console.error("[Notifications] load failed:", error);
    } finally {
      setLoading(false);
    }
  }

  const movementIndexes = useMemo(() => {
    const byOdr = new Map();
    const byBatch = new Map();
    movements.forEach((movement) => {
      if (movement.odr_number) appendMap(byOdr, String(movement.odr_number), movement);
      if (movement.upload_batch_id) appendMap(byBatch, String(movement.upload_batch_id), movement);
    });
    return { byOdr, byBatch };
  }, [movements]);

  const options = useMemo(() => {
    const divisions = new Set();
    const states = new Set();
    const districts = new Set();
    const stations = new Map();
    const commodities = new Map();
    const rakeCmdts = new Map();

    const commodityScoped =
      filters.commodities.length === 0
        ? movements
        : movements.filter((movement) => filters.commodities.includes(getCommodityCode(movement)));

    movements.forEach((movement) => {
      if (movement.division) divisions.add(movement.division);
      for (const station of [movement.station_from, movement.station_to]) {
        if (!station) continue;
        stations.set(station, formatStationNameAndCode(station));
        const meta = getStationMeta(station);
        if (meta?.state) states.add(meta.state);
        if (meta?.district) districts.add(meta.district);
      }

      const commodity = getCommodityCode(movement);
      if (commodity) commodities.set(commodity, getCommodityDisplay(movement));

    });

    commodityScoped.forEach((movement) => {
      const rakeCmdt = getRakeCmdtCode(movement);
      if (rakeCmdt) rakeCmdts.set(rakeCmdt, getRakeCmdtDisplay(movement));
    });

    return {
      divisions: [...divisions].sort().map((division) => ({
        value: division,
        label: `${getDivisionName(division)} (${division})`,
        searchText: `${division} ${getDivisionName(division)}`,
      })),
      states: [...states].sort(),
      districts: [...districts].sort(),
      stations: mapOptions(stations),
      commodities: mapOptions(commodities),
      rakeCmdts: mapOptions(rakeCmdts),
    };
  }, [filters.commodities, movements]);

  const filtered = useMemo(() => {
    return notifs.filter((notification) => {
      if (isInwardType(notification.type) && !filters.showInward) return false;
      if (isOutwardType(notification.type) && !filters.showOutward) return false;

      if (!optionMatches(filters.divisions, notification.related_division || "")) {
        return false;
      }

      const needsMovementMatch =
        filters.states.length > 0 ||
        filters.districts.length > 0 ||
        filters.stations.length > 0 ||
        filters.commodities.length > 0 ||
        filters.rakeCmdts.length > 0;

      if (!needsMovementMatch) return true;

      const relatedMovements = getRelatedMovements(notification, movementIndexes);
      if (relatedMovements.length === 0) return false;

      return relatedMovements.some((movement) => movementMatchesFilters(movement, filters));
    });
  }, [filters, movementIndexes, notifs]);

  const unreadCount = notifs.filter((notification) => !notification.is_read).length;
  const hasActiveFilters =
    filters.showInward !== true ||
    filters.showOutward !== true ||
    filters.divisions.length > 0 ||
    filters.states.length > 0 ||
    filters.districts.length > 0 ||
    filters.stations.length > 0 ||
    filters.commodities.length > 0 ||
    filters.rakeCmdts.length > 0;

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function applyFilterState(nextFilters) {
    setFilters({
      showInward: nextFilters.showInward ?? true,
      showOutward: nextFilters.showOutward ?? true,
      divisions: normalizeMultiValue(nextFilters.divisions ?? nextFilters.filterDivision),
      states: normalizeMultiValue(nextFilters.states),
      districts: normalizeMultiValue(nextFilters.districts),
      stations: normalizeMultiValue(
        nextFilters.stations ??
          nextFilters.selectedStations ??
          nextFilters.selectedInwardStations
      ),
      commodities: normalizeMultiValue(nextFilters.commodities ?? nextFilters.filterComm),
      rakeCmdts: normalizeMultiValue(nextFilters.rakeCmdts ?? nextFilters.filterRakeCmdt),
    });
  }

  async function saveCurrentFilter() {
    if (!user?.id) return;
    writePersistentFilters(FILTER_SOURCE, user.id, filters);
    const saved = await base44.entities.SavedFilter.create({
      user_id: user.id,
      name: buildFilterName(filters),
      source: SAVED_SOURCE,
      filters,
    });
    setSavedFilters((prev) => [saved, ...prev]);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    if (user?.id) clearPersistentFilters(FILTER_SOURCE, user.id);
  }

  async function markAllRead() {
    await base44.notifications.markAllRead();
    await loadData();
  }

  async function markRead(notification) {
    if (notification.is_read) return;
    await base44.notifications.markRead(notification.id);
    setNotifs((prev) =>
      prev.map((item) =>
        item.id === notification.id ? { ...item, is_read: true } : item
      )
    );
  }

  async function deleteNotification(notification) {
    await base44.entities.RailNotification.delete(notification.id);
    setNotifs((prev) => prev.filter((item) => item.id !== notification.id));
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Inward and Outward movement notifications
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-2 text-sm text-primary transition-colors hover:text-primary/80"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show</span>
          <CheckboxFilter checked={filters.showInward} onChange={(value) => setFilter("showInward", value)} label="Inward / Arrival" color="text-emerald-600" bgColor="bg-emerald-500/10" borderColor="border-emerald-500/30" />
          <CheckboxFilter checked={filters.showOutward} onChange={(value) => setFilter("showOutward", value)} label="Outward / Departure" color="text-blue-600" bgColor="bg-blue-500/10" borderColor="border-blue-500/30" />
        </div>

        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter label="Division" selected={filters.divisions} onChange={(value) => setFilter("divisions", value)} options={options.divisions} placeholder="All Divisions" />
          <MultiSelectFilter label="State" selected={filters.states} onChange={(value) => setFilter("states", value)} options={options.states} placeholder="All States" />
          <MultiSelectFilter label="District" selected={filters.districts} onChange={(value) => setFilter("districts", value)} options={options.districts} placeholder="All Districts" />
          <MultiSelectFilter label="Station" selected={filters.stations} onChange={(value) => setFilter("stations", value)} options={options.stations} placeholder="All Stations" />
          <MultiSelectFilter
            label="Commodity"
            selected={filters.commodities}
            onChange={(value) =>
              setFilters((prev) => ({ ...prev, commodities: value, rakeCmdts: [] }))
            }
            options={options.commodities}
            placeholder="All Commodities"
          />
          <MultiSelectFilter
            label="Rake CMDT"
            selected={filters.rakeCmdts}
            onChange={(value) => setFilters((prev) => ({ ...prev, rakeCmdts: value }))}
            options={options.rakeCmdts}
            placeholder="All Rake CMDT"
          />

          {savedFilters.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                const saved = savedFilters.find((item) => item.id === event.target.value);
                if (saved?.filters) applyFilterState(saved.filters);
              }}
              className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">Apply Saved Filter</option>
              {savedFilters.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={saveCurrentFilter}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            <Save className="h-3.5 w-3.5" />
            Save Filter
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              Clear Filter
            </button>
          )}
        </div>

        {filters.stations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Active Stations:
            </span>
            {filters.stations.map((station) => (
              <span key={station} className="inline-flex items-center gap-1 rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {formatStationNameAndCode(station)}
                <button
                  type="button"
                  onClick={() =>
                    setFilter(
                      "stations",
                      filters.stations.filter((item) => item !== station)
                    )
                  }
                  className="ml-0.5 font-bold hover:text-destructive"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {notifs.length} notifications
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Bell className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">No notifications match your filters</p>
            <p className="mt-1 text-xs">Try adjusting the saved filter set above</p>
          </div>
        ) : (
          filtered.map((notification) => {
            const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.Inward;
            const IconComp = config.icon;
            return (
              <div
                key={notification.id}
                onClick={() => markRead(notification)}
                className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-all ${
                  !notification.is_read
                    ? "border-primary/20 bg-primary/5 hover:bg-primary/10"
                    : "border-border bg-card hover:bg-muted/30"
                }`}
              >
                <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${config.bg}`}>
                  <IconComp className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{notification.title}</span>
                    {!notification.is_read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
                    <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
                      notification.severity === "error"
                        ? "border-red-500/20 bg-red-500/10 text-red-400"
                        : notification.severity === "warning"
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                          : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {notification.severity || "info"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{notification.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {config.label}
                    </span>
                    {notification.related_division && (
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {getDivisionName(notification.related_division)} ({notification.related_division})
                      </span>
                    )}
                    {notification.related_odr && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {notification.related_odr}
                      </span>
                    )}
                    {notification.created_date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(notification.created_date).toLocaleString("en-IN")}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteNotification(notification);
                  }}
                  className="flex-shrink-0 p-1 text-muted-foreground transition-colors hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
    <label className={`flex cursor-pointer select-none items-center gap-2.5 rounded-lg border px-3 py-2 transition-all ${
      checked ? `${bgColor} ${borderColor}` : "border-border bg-muted opacity-50"
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer rounded accent-current"
      />
      <span className={`text-xs font-medium ${checked ? color : "text-muted-foreground"}`}>{label}</span>
    </label>
  );
}

function appendMap(map, key, value) {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

function getRelatedMovements(notification, indexes) {
  const rows = [];
  if (notification.related_odr) {
    rows.push(...(indexes.byOdr.get(String(notification.related_odr)) || []));
  }
  if (notification.batch_id) {
    rows.push(...(indexes.byBatch.get(String(notification.batch_id)) || []));
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function movementMatchesFilters(movement, filters) {
  const stationCodes = [movement.station_from, movement.station_to].filter(Boolean);
  const stationMetas = stationCodes.map((station) => getStationMeta(station)).filter(Boolean);
  const states = new Set([
    movement.from_state,
    movement.to_state,
    ...stationMetas.map((meta) => meta.state),
  ].filter(Boolean));
  const districts = new Set([
    movement.from_district,
    movement.to_district,
    ...stationMetas.map((meta) => meta.district),
  ].filter(Boolean));

  return (
    (filters.states.length === 0 || filters.states.some((state) => states.has(state))) &&
    (filters.districts.length === 0 || filters.districts.some((district) => districts.has(district))) &&
    (filters.stations.length === 0 || filters.stations.some((station) => stationCodes.includes(station))) &&
    optionMatches(filters.commodities, getCommodityCode(movement)) &&
    optionMatches(filters.rakeCmdts, getRakeCmdtCode(movement))
  );
}

function isInwardType(type) {
  return INWARD_TYPES.includes(type);
}

function isOutwardType(type) {
  return OUTWARD_TYPES.includes(type);
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

function buildFilterName(filters) {
  const parts = [
    ...filters.divisions,
    ...filters.states,
    ...filters.districts,
    ...filters.stations,
    ...filters.commodities,
    ...filters.rakeCmdts,
  ].filter(Boolean);
  return parts.slice(0, 4).join(" + ") || "Notification Filter";
}

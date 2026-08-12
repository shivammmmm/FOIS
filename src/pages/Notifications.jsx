import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  Bell,
  CheckCheck,
  Save,
  Trash2,
  Check,
  FileText,
  Truck,
  Train,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { useAuth } from "@/lib/AuthContext";
import {
  getBusinessRakeCmdtCode as getRakeCmdtCode,
} from "@/utils/freightRecordFilters";
import { getStationMeta, registerStationMetaFromRecords } from "@/utils/stationMaster";
import { useMasterHierarchy } from "@/utils/masterHierarchy";
import { buildFilterHierarchyOptions } from "@/utils/filterHierarchy";
import {
  clearPersistentFilters,
  normalizeMultiValue,
  optionMatches,
  readPersistentFilters,
  writePersistentFilters,
} from "@/utils/persistentFilters";

const FILTER_SOURCE = "notifications";
const SAVED_SOURCE = "Notifications";
const PAGE_SIZE = 500;

const TYPE_CONFIG = {
  Arrival: { icon: ArrowDownToLine, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Arrival" },
  Departure: { icon: ArrowUpFromLine, color: "text-blue-400", bg: "bg-blue-500/10", label: "Departure" },
  Inward: { icon: ArrowDownToLine, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Inward" },
  Outward: { icon: ArrowUpFromLine, color: "text-blue-400", bg: "bg-blue-500/10", label: "Outward" },
  AdminReview: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", label: "Manual Review" },
  IndentPlaced: { icon: FileText, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "New Demand" },
  NewRakeDemand: { icon: FileText, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "New Demand" },
  IndentSupplied: { icon: Truck, color: "text-amber-400", bg: "bg-amber-500/10", label: "Rake Supplied" },
  RakeSupplied: { icon: Truck, color: "text-amber-400", bg: "bg-amber-500/10", label: "Rake Supplied" },
  RakeDispatched: { icon: Train, color: "text-blue-400", bg: "bg-blue-500/10", label: "Rake Dispatched" },
  DemandMatured: { icon: Train, color: "text-blue-400", bg: "bg-blue-500/10", label: "Rake Dispatched" },
};

const DEFAULT_FILTERS = {
  showNewDemand: true,
  showSupplied: true,
  showDispatched: true,
  zones: [],
  divisions: [],
  states: [],
  districts: [],
  stations: [],
  commodities: [],
  rakeCmdts: [],
  cnsr: [],
  cnsg: [],
};

export default function Notifications() {
  const { user } = useAuth();
  const didLoadPersisted = useRef(false);
  const saveFilterInFlight = useRef(false);
  const [notifs, setNotifs] = useState([]);
  const [movements, setMovements] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [hierarchy, setHierarchy] = useState(null);
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterSaveNotice, setFilterSaveNotice] = useState(null);
  const [appliedSavedFilterId, setAppliedSavedFilterId] = useState("");
  const { getDivisionName } = useMasterHierarchy();

  const divisionZoneCode = useMemo(
    () => Object.fromEntries((hierarchy?.divisions || []).filter((d) => d.parentCode).map((d) => [d.code, d.parentCode])),
    [hierarchy]
  );

  const scoped = buildFilterHierarchyOptions(hierarchy || {}, {
    zone: filters.zones,
    division: filters.divisions,
    state: filters.states,
    district: filters.districts,
    commodity: filters.commodities,
  });

  const options = useMemo(() => {
    return {
      zones: scoped.zones,
      divisions: scoped.divisions,
      states: scoped.states,
      districts: scoped.districts,
      stations: scoped.stations,
      commodities: scoped.commodities,
      rakeCmdts: scoped.rakeCmdts,
      // filterHierarchy() has no CNSR/CNSG lists (they aren't master data),
      // so options are drawn from whatever movements are already loaded on
      // this page — the same source the "unmapped stations" callout uses.
      cnsr: uniqueSorted(movements.map(getCnsrCode)),
      cnsg: uniqueSorted(movements.map(getCnsgCode)),
    };
  }, [scoped, movements]);

  useEffect(() => {
    loadData();
  }, [user?.id]);

  useEffect(() => {
    base44.filterHierarchy().then(setHierarchy).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (didLoadPersisted.current || !user?.id) return;
    didLoadPersisted.current = true;
    const persisted = readPersistentFilters(FILTER_SOURCE, user.id);
    if (persisted) applyFilterState(persisted);
  }, [user?.id]);

  function movementsOfNotification(row) {
    if (Array.isArray(row.movements) && row.movements.length) return row.movements;
    return row.movement ? [row.movement] : [];
  }

  async function loadData() {
    setLoading(true);
    try {
      const [notifResponse, savedRows] = await Promise.all([
        base44.notifications.list({ page: 1, limit: PAGE_SIZE }),
        user?.id
          ? base44.entities.SavedFilter.filter({ user_id: user.id }, "-created_at", 100)
          : Promise.resolve([]),
      ]);
      const notifData = notifResponse?.items || [];
      const movData = notifData.flatMap(movementsOfNotification);
      setNotifs(notifData);
      setMovements(movData);
      setPage(1);
      setHasMore(!!notifResponse?.hasMore);
      registerStationMetaFromRecords(movData);
      setSavedFilters(
        dedupeSavedFilters(
          (savedRows || []).filter((row) => row.source === SAVED_SOURCE)
        )
      );
    } catch (error) {
      console.error("[Notifications] load failed:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const notifResponse = await base44.notifications.list({ page: nextPage, limit: PAGE_SIZE });
      const newItems = notifResponse?.items || [];
      const newMovements = newItems.flatMap(movementsOfNotification);
      setNotifs((prev) => [...prev, ...newItems]);
      setMovements((prev) => [...prev, ...newMovements]);
      registerStationMetaFromRecords(newMovements);
      setPage(nextPage);
      setHasMore(!!notifResponse?.hasMore);
    } catch (error) {
      console.error("[Notifications] load more failed:", error);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  function isNewDemandType(type) {
    const t = String(type || "").toLowerCase();
    return t.includes("indentplaced") || t.includes("newrakedemand") || t.includes("demandcreated") || t.includes("new demand");
  }

  function isSuppliedType(type) {
    const t = String(type || "").toLowerCase();
    return t.includes("indentsupplied") || t.includes("rakesupplied") || t.includes("partialsupplyupdated") || t.includes("rake supplied");
  }

  function isDispatchedType(type) {
    const t = String(type || "").toLowerCase();
    return t.includes("rakedispatched") || t.includes("demandmatured") || t.includes("demandcompleted") || t.includes("rake dispatched");
  }

  const filteredNotifs = useMemo(() => {
    return notifs.filter((notification) => {
      const notifType = notification.notification_type || notification.type || "";

      if (isNewDemandType(notifType) && !filters.showNewDemand) return false;
      if (isSuppliedType(notifType) && !filters.showSupplied) return false;
      if (isDispatchedType(notifType) && !filters.showDispatched) return false;

      if (!optionMatches(filters.divisions, notification.related_division || "")) {
        return false;
      }

      if (!optionMatches(filters.zones, divisionZoneCode[notification.related_division] || "")) {
        return false;
      }

      const needsMovementMatch =
        filters.states.length > 0 ||
        filters.districts.length > 0 ||
        filters.stations.length > 0 ||
        filters.commodities.length > 0 ||
        filters.rakeCmdts.length > 0 ||
        filters.cnsr.length > 0 ||
        filters.cnsg.length > 0;

      if (!needsMovementMatch) return true;

      const relatedMovements = getRelatedMovements(notification, movementIndexes);
      if (relatedMovements.length === 0) return false;

      return relatedMovements.some((movement) => movementMatchesFilters(movement, filters));
    });
  }, [filters, movementIndexes, notifs, divisionZoneCode]);

  const displayNotifs = useMemo(() => {
    return filteredNotifs.filter((notification) => !notification.is_read);
  }, [filteredNotifs]);

  const unreadCount = displayNotifs.length;

  const hasActiveFilters =
    filters.showNewDemand !== true ||
    filters.showSupplied !== true ||
    filters.showDispatched !== true ||
    filters.zones.length > 0 ||
    filters.divisions.length > 0 ||
    filters.states.length > 0 ||
    filters.districts.length > 0 ||
    filters.stations.length > 0 ||
    filters.commodities.length > 0 ||
    filters.rakeCmdts.length > 0 ||
    filters.cnsr.length > 0 ||
    filters.cnsg.length > 0;

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function applyFilterState(nextFilters) {
    setFilters({
      showNewDemand: nextFilters.showNewDemand ?? nextFilters.showInward ?? true,
      showSupplied: nextFilters.showSupplied ?? true,
      showDispatched: nextFilters.showDispatched ?? nextFilters.showOutward ?? true,
      zones: normalizeMultiValue(nextFilters.zones ?? nextFilters.filterZone),
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
      cnsr: normalizeMultiValue(nextFilters.cnsr),
      cnsg: normalizeMultiValue(nextFilters.cnsg),
    });
  }

  async function saveCurrentFilter() {
    if (!user?.id || saveFilterInFlight.current) return;
    saveFilterInFlight.current = true;
    setSavingFilter(true);
    setFilterSaveNotice(null);
    const normalizedFilters = normalizeNotificationFilters(filters);
    const signature = savedFilterSignature(normalizedFilters);
    const filterName = buildFilterName(normalizedFilters);
    try {
      writePersistentFilters(FILTER_SOURCE, user.id, normalizedFilters);
      const existing = savedFilters.find(
        (savedFilter) =>
          savedFilterSignature(savedFilter.filters) === signature
      );
      if (existing) {
        setAppliedSavedFilterId(existing.id);
        setFilterSaveNotice({
          kind: "info",
          text: `"${existing.name}" filter updated.`,
        });
        return;
      }

      const created = await base44.entities.SavedFilter.create({
        user_id: user.id,
        source: SAVED_SOURCE,
        name: filterName,
        filters: normalizedFilters,
        notifications_enabled: true,
      });

      setSavedFilters((prev) => dedupeSavedFilters([created, ...prev]));
      setAppliedSavedFilterId(created.id);
      setFilterSaveNotice({
        kind: "success",
        text: `Saved filter "${filterName}".`,
      });
    } catch (error) {
      console.error("[Notifications] Save filter failed:", error);
      setFilterSaveNotice({
        kind: "error",
        text: error?.message || "Failed to save filter.",
      });
    } finally {
      saveFilterInFlight.current = false;
      setSavingFilter(false);
    }
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedSavedFilterId("");
    setFilterSaveNotice(null);
    if (user?.id) clearPersistentFilters(FILTER_SOURCE, user.id);
  }

  async function markAllRead() {
    setNotifs([]);
    await base44.notifications.markAllRead().catch(() => undefined);
  }

  async function markRead(notification) {
    if (notification.is_read) return;
    setNotifs((prev) => prev.filter((item) => item.id !== notification.id));
    await base44.notifications.markRead(notification.id).catch(() => undefined);
  }

  async function deleteNotification(notification) {
    await base44.entities.RailNotification.delete(notification.id).catch(() => undefined);
    setNotifs((prev) => prev.filter((item) => item.id !== notification.id));
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-7xl mx-auto">
      {/* Top Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Bell className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <span className="rounded-full bg-destructive px-2.5 py-0.5 text-xs font-bold text-white shadow-xs">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Inward and Outward movement notifications & alerts
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 shadow-xs cursor-pointer"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all as read
          </button>
        )}
      </div>

      {/* Filter Control Section */}
      <div className="space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notification Type</span>
          <CheckboxFilter checked={filters.showNewDemand} onChange={(value) => setFilter("showNewDemand", value)} label="📝 New Rack Indent" color="text-emerald-600" bgColor="bg-emerald-500/10" borderColor="border-emerald-500/30" />
          <CheckboxFilter checked={filters.showSupplied} onChange={(value) => setFilter("showSupplied", value)} label="🚚 Rack Supplied" color="text-amber-600" bgColor="bg-amber-500/10" borderColor="border-amber-500/30" />
          <CheckboxFilter checked={filters.showDispatched} onChange={(value) => setFilter("showDispatched", value)} label="🚆 Rack Dispatched" color="text-blue-600" bgColor="bg-blue-500/10" borderColor="border-blue-500/30" />
        </div>

        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter label="Zone" selected={filters.zones} onChange={(value) => setFilters((prev) => ({ ...prev, zones: value, divisions: [], stations: [] }))} options={options.zones} placeholder="All Zones" />
          <MultiSelectFilter label="Division" selected={filters.divisions} onChange={(value) => setFilters((prev) => ({ ...prev, divisions: value, stations: [] }))} options={options.divisions} placeholder="All Divisions" />
          <MultiSelectFilter label="State" selected={filters.states} onChange={(value) => setFilters((prev) => ({ ...prev, states: value, districts: [], stations: [] }))} options={options.states} placeholder="All States" />
          <MultiSelectFilter label="District" selected={filters.districts} onChange={(value) => setFilters((prev) => ({ ...prev, districts: value, stations: [] }))} options={options.districts} placeholder="All Districts" />
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
          <MultiSelectFilter
            label="CNSR"
            selected={filters.cnsr}
            onChange={(value) => setFilter("cnsr", value)}
            options={options.cnsr}
            placeholder="All Consignors"
          />
          <MultiSelectFilter
            label="CNSG"
            selected={filters.cnsg}
            onChange={(value) => setFilter("cnsg", value)}
            options={options.cnsg}
            placeholder="All Consignees"
          />

          {savedFilters.length > 0 && (
            <select
              value={appliedSavedFilterId}
              onChange={(event) => {
                const saved = savedFilters.find((item) => item.id === event.target.value);
                setAppliedSavedFilterId(event.target.value);
                if (saved?.filters) {
                  applyFilterState(saved.filters);
                  setFilterSaveNotice({
                    kind: "info",
                    text: `"${saved.name}" applied.`,
                  });
                }
              }}
              className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none cursor-pointer"
            >
              <option value="">Apply Saved Filter</option>
              {savedFilters.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.notifications_enabled === false ? "" : "🔔 "}{saved.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={saveCurrentFilter}
            disabled={savingFilter}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/30 px-3 py-2 text-xs font-semibold text-primary transition-all hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingFilter ? "Saving..." : "Save Filter"}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive transition-all hover:bg-destructive/10 cursor-pointer"
            >
              Clear Filter
            </button>
          )}
        </div>

        {filterSaveNotice && (
          <div
            className={`text-xs p-2.5 rounded-xl border ${
              filterSaveNotice.kind === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-400"
            }`}
          >
            {filterSaveNotice.text}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Active Notifications: <span className="font-semibold text-foreground">{displayNotifs.length}</span>
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {loading ? (
          [...Array(5)].map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-card border border-border" />
          ))
        ) : displayNotifs.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground bg-card border border-border/80 rounded-2xl p-8">
            <Bell className="mx-auto mb-3 h-10 w-10 opacity-30 text-primary" />
            <p className="text-sm font-bold text-foreground">No active notifications</p>
            <p className="mt-1 text-xs text-muted-foreground">All notifications have been marked as read.</p>
          </div>
        ) : (
          displayNotifs.map((notification) => {
            const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.Inward;
            const IconComp = config.icon;
            const relatedRakes = movementsOfNotification(notification);
            const isExpanded = expanded.has(notification.id);
            return (
              <div
                key={notification.id}
                className="flex items-start gap-4 rounded-2xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all shadow-xs p-4"
              >
                <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${config.bg}`}>
                  <IconComp className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{notification.title}</span>
                    <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                    <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      notification.severity === "error"
                        ? "border-red-500/30 bg-red-500/10 text-red-400"
                        : notification.severity === "warning"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {notification.severity || "info"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-xs leading-6 text-muted-foreground">{notification.message}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-lg border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {config.label}
                    </span>
                    {notification.related_division && (
                      <span className="rounded-lg border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {getDivisionName(notification.related_division)} ({notification.related_division})
                      </span>
                    )}
                    {notification.related_odr && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {notification.related_odr}
                      </span>
                    )}
                    {notification.created_date && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(notification.created_date).toLocaleString("en-IN")}
                      </span>
                    )}
                    {relatedRakes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(notification.id)}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        {isExpanded ? "Hide rakes" : `View ${relatedRakes.length} rakes`}
                      </button>
                    )}
                  </div>
                  {isExpanded && relatedRakes.length > 1 && (
                    <div className="mt-3 space-y-1 rounded-xl border border-border bg-muted/40 p-3">
                      {relatedRakes.map((rake, index) => (
                        <div
                          key={rake.id || rake.odr_number || index}
                          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                          <span className="font-mono text-foreground font-semibold">{rake.odr_number || "-"}</span>
                          <span>{rake.commodity_name || rake.commodity_code || rake.commodity || "-"}</span>
                          <span>{rake.company_name || rake.company || rake.company_code || "-"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => markRead(notification)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-primary/30 bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 transition-all cursor-pointer shadow-2xs"
                    title="Mark as Read"
                  >
                    <Check className="h-3.5 w-3.5 text-primary" />
                    <span>Mark Read</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteNotification(notification)}
                    className="p-1.5 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                    title="Delete Notification"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-xl border border-border bg-card px-5 py-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-all shadow-xs cursor-pointer"
          >
            {loadingMore ? "Loading..." : "Load More Notifications"}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckboxFilter({ checked, onChange, label, color, bgColor, borderColor }) {
  return (
    <label className={`flex cursor-pointer select-none items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
      checked ? `${bgColor} ${borderColor}` : "border-border bg-muted opacity-50"
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer rounded accent-current"
      />
      <span className={`text-xs font-bold ${checked ? color : "text-muted-foreground"}`}>{label}</span>
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
    optionMatches(filters.rakeCmdts, getRakeCmdtCode(movement)) &&
    optionMatches(filters.cnsr, getCnsrCode(movement)) &&
    optionMatches(filters.cnsg, getCnsgCode(movement))
  );
}

function dedupeSavedFilters(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${item.name || ""}|${savedFilterSignature(item.filters)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function savedFilterSignature(filterData) {
  if (!filterData || typeof filterData !== "object") return "";
  const obj = {
    showNewDemand: filterData.showNewDemand ?? true,
    showSupplied: filterData.showSupplied ?? true,
    showDispatched: filterData.showDispatched ?? true,
    zones: (filterData.zones || []).slice().sort(),
    divisions: (filterData.divisions || []).slice().sort(),
    states: (filterData.states || []).slice().sort(),
    districts: (filterData.districts || []).slice().sort(),
    stations: (filterData.stations || []).slice().sort(),
    commodities: (filterData.commodities || []).slice().sort(),
    rakeCmdts: (filterData.rakeCmdts || []).slice().sort(),
    cnsr: (filterData.cnsr || []).slice().sort(),
    cnsg: (filterData.cnsg || []).slice().sort(),
  };
  return JSON.stringify(obj);
}

function normalizeNotificationFilters(source) {
  return {
    showNewDemand: source.showNewDemand ?? true,
    showSupplied: source.showSupplied ?? true,
    showDispatched: source.showDispatched ?? true,
    zones: Array.isArray(source.zones) ? source.zones : [],
    divisions: Array.isArray(source.divisions) ? source.divisions : [],
    states: Array.isArray(source.states) ? source.states : [],
    districts: Array.isArray(source.districts) ? source.districts : [],
    stations: Array.isArray(source.stations) ? source.stations : [],
    commodities: Array.isArray(source.commodities) ? source.commodities : [],
    rakeCmdts: Array.isArray(source.rakeCmdts) ? source.rakeCmdts : [],
    cnsr: Array.isArray(source.cnsr) ? source.cnsr : [],
    cnsg: Array.isArray(source.cnsg) ? source.cnsg : [],
  };
}

function buildFilterName(filt) {
  const parts = [];
  if (filt.zones?.length) parts.push(`Z:${filt.zones.join(",")}`);
  if (filt.divisions?.length) parts.push(`Div:${filt.divisions.join(",")}`);
  if (filt.stations?.length) parts.push(`Stn:${filt.stations.join(",")}`);
  if (filt.commodities?.length) parts.push(`Cmdt:${filt.commodities.join(",")}`);
  if (filt.rakeCmdts?.length) parts.push(`Rake:${filt.rakeCmdts.join(",")}`);
  if (filt.cnsr?.length) parts.push(`Cnsr:${filt.cnsr.join(",")}`);
  if (filt.cnsg?.length) parts.push(`Cnsg:${filt.cnsg.join(",")}`);
  return parts.length ? parts.join(" | ") : "All Notifications";
}

function getCommodityCode(movement) {
  return movement.commodity_code || movement.commodity || movement.raw_data?.CMDT || "";
}

function getCnsrCode(movement) {
  return movement.company || movement.company_code || movement.cnsr || movement.raw_data?.cnsr || movement.raw_data?.CNSR || "";
}

function getCnsgCode(movement) {
  return movement.cnsg || movement.consignee || movement.raw_data?.cnsg || movement.raw_data?.CNSG || "";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Search,
  X,
  FileSpreadsheet,
  Download,
  Upload,
} from "lucide-react";
import { apiClient } from "../api/apiClient";
import SearchableSelect from "@/components/SearchableSelect";

const DEFAULT_PAGE_SIZE = 50;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // safety

const EMPTY_FORM = {
  station_code: "",
  station_name: "",
  district: "",
  state: "",
  division: "",
  zone: "",
  is_active: true,
};

function toEmptyString(v) {
  return v == null ? "" : String(v);
}

function normalizeStationCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeMasterCode(code) {
  return String(code || "").trim().toUpperCase();
}

function authHeaders() {
  const token = localStorage.getItem("token") || "";
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function asItems(data) {
  return Array.isArray(data) ? data : data?.items || [];
}

function resolveStateCode(value, stateOptions) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = normalizeMasterCode(raw);
  const matchByCode = stateOptions.find(
    (state) => normalizeMasterCode(state?.code) === normalized
  );
  if (matchByCode?.code) return normalizeMasterCode(matchByCode.code);

  const matchByName = stateOptions.find(
    (state) => String(state?.name || "").trim().toUpperCase() === normalized
  );
  if (matchByName?.code) return normalizeMasterCode(matchByName.code);

  return raw.includes(" ") && stateOptions.length === 0 ? "" : normalized;
}


async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.split(",").pop();
        resolve(base64);
      } else {
        reject(new Error("Unexpected file reader result"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function StationMaster() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  // --- Dynamic Master States for Cascading Selectors ---
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil((total || 0) / (pageSize || DEFAULT_PAGE_SIZE)));
  }, [total, pageSize]);

  const load = async () => {
    setLoading(true);
    try {
      const limit = pageSize;
      const offset = (page - 1) * pageSize;
      const data = await apiClient.stationMaster.list({ search, offset, limit });

      if (Array.isArray(data)) {
        setRows(data);
        setTotal(data.length);
      } else {
        setRows(data.items || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error(e);
      setRows([]);
      setTotal(0);
    }
    setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(t);
  }, [search, page, pageSize]);

  // Load active master states when form opens (native fetch from /api/masters)
  useEffect(() => {
    if (!showForm) return;

    const loadStates = async () => {
      setLoadingStates(true);
      try {
        const res = await fetch("/api/masters/states", {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error("Failed to load states");
        const data = await res.json();
        const items = asItems(data).map((state) => ({
          ...state,
          code: normalizeMasterCode(state?.code),
        }));
        setStates(items);
      } catch (err) {
        console.error("Failed to load states:", err);
        setStates([]);
      } finally {
        setLoadingStates(false);
      }
    };

    loadStates();
  }, [showForm]);

  useEffect(() => {
    if (!showForm || !form.state || states.length === 0) return;

    const stateCode = resolveStateCode(form.state, states);
    if (!stateCode || stateCode === form.state) return;

    setForm((current) =>
      current.state === form.state ? { ...current, state: stateCode } : current
    );
  }, [form.state, showForm, states]);

  // Cascading effect: Load districts when state changes inside form parameters (native fetch)
  useEffect(() => {
    if (!showForm) return;
    const stateCode = resolveStateCode(form.state, states);
    if (!stateCode) {
      setDistricts([]);
      return;
    }

    const loadDistricts = async () => {
      setLoadingDistricts(true);
      try {
        console.info("[StationMaster] Loading districts", { stateCode });
        const res = await fetch(`/api/masters/districts?state_code=${encodeURIComponent(stateCode)}`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error("Failed to load districts");
        const data = await res.json();
        const items = asItems(data);
        setDistricts(items);
        console.info("[StationMaster] Districts loaded", {
          stateCode,
          count: items.length,
        });
      } catch (err) {
        console.error("Failed to load districts:", err);
        setDistricts([]);
      } finally {
        setLoadingDistricts(false);
      }
    };

    loadDistricts();
  }, [form.state, showForm, states]);


  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setDistricts([]);
    setShowForm(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    setForm({
      station_code: toEmptyString(row.station_code),
      station_name: toEmptyString(row.station_name),
      district: toEmptyString(row.district),
      state: toEmptyString(row.state),
      division: toEmptyString(row.division),
      zone: toEmptyString(row.zone),
      is_active: row.is_active !== false,
    });
    setShowForm(true);
  };

const handleSave = async () => {
    if (saving) return;

    // Live station-code existence check against the preloaded arrays.
    // Arrays are loaded from existing table rows (states/districts are for cascading,
    // station-code warning uses the currently loaded station master rows).
    const normalizedCode = normalizeStationCode(form.station_code);
    const existsInLoadedRows = rows.some((r) => normalizeStationCode(r.station_code) === normalizedCode);
    if (normalizedCode && existsInLoadedRows && !editing) {
      alert("⚠️ This Station Code already exists! Use Edit to update an existing record.");
      return;
    }

    const payload = {
      station_code: normalizeStationCode(form.station_code),
      station_name: String(form.station_name || "").trim(),
      district: String(form.district || "").trim() || null,
      state: String(form.state || "").trim() || null,
      division: String(form.division || "").trim() || null,
      zone: String(form.zone || "").trim() || null,
      is_active: !!form.is_active,
    };

    if (!payload.station_code || !payload.station_name) {
      alert("Station code and station name are required");
      return;
    }
    if (!payload.state || !payload.district) {
      alert("Please select a valid State and District combination from dropdown rules");
      return;
    }

    try {
      setSaving(true);
      await apiClient.stationMaster.save(payload);

      setShowForm(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to save record");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    const ok = window.confirm(`Delete station master for ${row.station_code}?`);
    if (!ok) return;

    try {
      setSaving(true);
      await apiClient.stationMaster.delete(row.id);

      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await apiClient.stationMaster.export();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "station_master.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Export failed");
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("File too large (max ~20MB)");
      return;
    }

    setUploading(true);
    setUploadResult(null);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const result = await apiClient.stationMaster.upload({
        fileName: file.name,
        fileBase64,
      });
      setUploadResult(result);
      await load();
    } catch (e) {
      console.error(e);
      setUploadResult({ success: false, message: e?.message || "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Station Master</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Master database of railway freight station codes
          </p>
        </div>

        <div className="flex gap-2 flex-wrap justify-end">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted/30 transition-colors"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Record
          </button>
        </div>
      </div>

      {/* Upload */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground">Excel Upload</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Headers: station_code, station_name, district, state, division, zone
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-muted hover:bg-muted/80 transition-colors cursor-pointer ${
                uploading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading..." : "Upload Excel"}
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                disabled={uploading}
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
            </label>
          </div>
        </div>

        {uploadResult && (
          <div
            className={`mt-4 rounded-xl border p-4 text-sm ${
              uploadResult.failed > 0
                ? "border-red-500/30 bg-red-500/5"
                : "border-emerald-500/30 bg-emerald-500/5"
            }`}
          >
            <div className="font-semibold">Upload summary</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {[
                ["Total", uploadResult.total],
                ["Inserted", uploadResult.inserted],
                ["Updated", uploadResult.updated],
                ["Failed", uploadResult.failed],
              ].map(([k, v]) => (
                <div key={k} className="bg-muted/40 rounded-lg p-2">
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                  <div className="font-semibold text-foreground mt-0.5">{v ?? 0}</div>
                </div>
              ))}
            </div>
            {uploadResult.batch_id && (
              <div className="text-xs text-muted-foreground mt-2">Batch: {uploadResult.batch_id}</div>
            )}
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[280px] bg-muted border border-border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search station code / name / district / state..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <X
              className="w-3.5 h-3.5 text-muted-foreground cursor-pointer"
              onClick={() => setSearch("")}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid Table Workspace */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Station Code",
                  "Station Name",
                  "District",
                  "State",
                  "Division",
                  "Zone",
                  "Active",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(8)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {search ? "No matching stations found." : "No station masters found."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id || r.station_code}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-primary">
                      {r.station_code}
                    </td>
                    <td className="px-4 py-3">{r.station_name}</td>
                    <td className="px-4 py-3">{r.district || "-"}</td>
                    <td className="px-4 py-3">{r.state || "-"}</td>
                    <td className="px-4 py-3">{r.division || "-"}</td>
                    <td className="px-4 py-3">{r.zone || "-"}</td>
                    <td className="px-4 py-3">{r.is_active === false ? "No" : "Yes"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="px-2 py-1 text-xs rounded border border-border bg-card hover:bg-muted/30"
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          className="p-1 rounded border border-border bg-card hover:bg-muted/30"
                          onClick={() => handleDelete(r)}
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Footnotes */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Page {page} of {totalPages} (Total: {total})
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 text-sm rounded-lg border border-border bg-card hover:bg-muted/30 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <button
            className="px-3 py-2 text-sm rounded-lg border border-border bg-card hover:bg-muted/30 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {editing ? "Edit Station" : "Add Station"}
                </h2>
                <p className="text-xs text-muted-foreground">Station master details</p>
              </div>
              <button
                className="px-3 py-1 rounded-lg border border-border bg-card hover:bg-muted/30"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ ...EMPTY_FORM });
                }}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <label className="space-y-1">
                <div className="text-xs text-muted-foreground">Station Code *</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none uppercase font-mono"
                  value={form.station_code}
                  onChange={(e) => setForm((f) => ({ ...f, station_code: e.target.value }))}
                  disabled={!!editing}
                />
              </label>
              
              <label className="space-y-1">
                <div className="text-xs text-muted-foreground">Station Name *</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
                  value={form.station_name}
                  onChange={(e) => setForm((f) => ({ ...f, station_name: e.target.value }))}
                />
              </label>

              {/* Searchable State Selector */}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  State * {loadingStates && <span className="text-[10px] text-primary animate-pulse">(Loading...)</span>}
                </div>
                <SearchableSelect
                  placeholder={loadingStates ? "Loading states..." : "-- Select State --"}
                  disabled={saving || loadingStates}
                  value={form.state}
                  options={states.map((st) => ({
                    value: String(st.code).trim().toUpperCase(),
                    label: `${st.name} (${st.code})`,
                  }))}
                  onChange={(val) => {
                    const selectedState = normalizeMasterCode(val);
                    setForm((f) => ({ ...f, state: selectedState, district: "" }));
                  }}
                />
              </div>

              {/* Searchable District Selector (cascades from State) */}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  District * {loadingDistricts && <span className="text-[10px] text-primary animate-pulse">(Filtering...)</span>}
                </div>
                <SearchableSelect
                  placeholder={
                    !form.state
                      ? "-- Select a state first --"
                      : loadingDistricts
                      ? "Loading districts..."
                      : "-- Select District --"
                  }
                  disabled={!form.state || loadingDistricts}
                  value={form.district}
                  options={districts.map((ds) => ({
                    value: ds.name,
                    label: ds.name,
                  }))}
                  onChange={(val) => setForm((f) => ({ ...f, district: val }))}
                />
              </div>

              <label className="space-y-1">
                <div className="text-xs text-muted-foreground">Division</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none text-transform: uppercase"
                  value={form.division}
                  onChange={(e) => setForm((f) => ({ ...f, division: e.target.value.toUpperCase() }))}
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs text-muted-foreground">Zone</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none text-transform: uppercase"
                  value={form.zone}
                  onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value.toUpperCase() }))}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="flex items-center gap-2 text-sm mt-2">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                  <span className="text-xs text-muted-foreground select-none">Active</span>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                className="px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted/30"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ ...EMPTY_FORM });
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

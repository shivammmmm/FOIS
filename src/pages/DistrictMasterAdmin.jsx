import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";

const DEFAULT_PAGE_SIZE = 50;

export default function DistrictMasterAdmin() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filter and Search States
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState("All");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);

  // Master Dropdown State
  const [statesPool, setStatesPool] = useState([]);

  // Form Modal States
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", parent_code: "", active: true });
  const [saving, setSaving] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  // Load parent states for filtering and dropdown creation parameters
  useEffect(() => {
    const loadStates = async () => {
      try {
        const res = await apiClient.stateMaster.list();
        setStatesPool(Array.isArray(res) ? res : res?.items || []);
      } catch (err) {
        console.error("Failed to load states for selection pool:", err);
      }
    };
    loadStates();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      // Build dynamic API queries using clean master parameters
      const params = {
        search: search.trim(),
        offset: (page - 1) * pageSize,
        limit: pageSize,
      };
      if (filterState !== "All") {
        params.state = filterState;
      }

      const res = await apiClient.districtMaster.list(params);
      const items = Array.isArray(res) ? res : res?.items || [];
      const t = res?.total ?? items.length;

      setRows(items);
      setTotal(t || 0);
    } catch (err) {
      console.error("Failed to fetch district structural list:", err);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterState, page]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", parent_code: filterState !== "All" ? filterState : "", active: true });
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row?.name || "",
      parent_code: row?.parent_code || "",
      active: row?.active !== false,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = String(form.name || "").trim();
    const parent_code = String(form.parent_code || "").trim();

    if (!name) return alert("District name is required");
    if (!parent_code) return alert("Parent state mapping is required");

    try {
      setSaving(true);
      const payload = {
        name,
        parent_code,
        active: !!form.active,
      };

      if (editing?.id) {
        await apiClient.districtMaster.update(editing.id, payload);
      } else {
        await apiClient.districtMaster.save(payload);
      }

      setShowForm(false);
      setEditing(null);
      setForm({ name: "", parent_code: "", active: true });
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || e?.message || "Failed to commit district setup");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    const ok = window.confirm(`Are you sure you want to delete district "${row?.name}"?\nThis configuration will fail if active stations rely on this specific district.`);
    if (!ok) return;
    try {
      setSaving(true);
      await apiClient.districtMaster.delete(row?.id || `district_master_${row?.parent_code}_${row?.code}`);
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || e?.message || "Relational database denied structural clear execution");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (saving || total === 0) return;
    const ok = window.confirm(
      `Delete all ${total} district records?\n\nThis cannot be undone. If any district is linked to Station Master, no records will be deleted.`
    );
    if (!ok) return;
    try {
      setSaving(true);
      const result = await apiClient.districtMaster.deleteAll();
      alert(`${result?.deleted_count || 0} district records deleted.`);
      setPage(1);
      setSearch("");
      setFilterState("All");
      await load();
    } catch (error) {
      console.error(error);
      alert(error?.message || "Failed to delete all districts");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">District Master</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure internal district parameters across parent state networks
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleDeleteAll} disabled={saving || total === 0} className="flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Delete All
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add District
          </button>
        </div>
      </div>

      {/* Filter and Search Action Row */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[280px] bg-muted border border-border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search district name..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <X
              className="w-3.5 h-3.5 text-muted-foreground cursor-pointer"
              onClick={() => setSearch("")}
            />
          )}
        </div>

        {/* State Filter Dropdown Drop */}
        <div className="flex items-center gap-2">
          <select
            className="bg-muted border border-border text-foreground text-sm rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-primary/50 transition-colors"
            value={filterState}
            onChange={(e) => {
              setFilterState(e.target.value);
              setPage(1);
            }}
          >
            <option value="All">All States Pool</option>
            {statesPool.map((st) => (
              <option key={st.id || st.code} value={st.code}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid Workspace Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["District Name", "Belongs To State", "Active Indicator", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
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
                    {[...Array(4)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No verified district constraints mapped to active state targets.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r?.id || `${r?.parent_code}_${r?.code}`}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{r?.name || "-"}</td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-primary">
                      {r?.parent_code || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        r?.active !== false 
                          ? "bg-emerald-500/10 text-emerald-500" 
                          : "bg-red-500/10 text-red-500"
                      }`}>
                        {r?.active === false ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="px-2 py-1 text-xs rounded border border-border bg-card hover:bg-muted/30 font-medium"
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

      {/* Pagination Grid View */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground font-medium">
          Page {page} of {totalPages} (Total: {total} records)
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted/30 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted/30 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>

      {/* Form Dialog Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-lg bg-card border border-border rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {editing ? "Edit District Properties" : "Register New District"}
                </h2>
                <p className="text-xs text-muted-foreground">Setup explicit regional structural bounds</p>
              </div>
              <button
                className="px-2 py-1 rounded-lg border border-border bg-card hover:bg-muted/30 text-xs font-semibold"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ name: "", parent_code: "", active: true });
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-4 mt-5">
              {/* Linked State Selector Group */}
              <label className="block space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Belongs to Parent State *</div>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  value={form.parent_code}
                  onChange={(e) => setForm((f) => ({ ...f, parent_code: e.target.value }))}
                  disabled={!!editing}
                >
                  <option value="">-- Choose State Association --</option>
                  {statesPool.map((st) => (
                    <option key={st.id || st.code} value={st.code}>
                      {st.name} ({st.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <div className="text-xs font-medium text-muted-foreground">District Name *</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Peddapalli, Indore, Purulia"
                />
              </label>

              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  className="rounded border-border bg-background text-primary"
                  checked={!!form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                <span className="text-xs font-medium text-muted-foreground select-none">Enable routing options for station assignment</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 border-t border-border pt-4">
              <button
                className="px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted/30 text-sm font-medium"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ name: "", parent_code: "", active: true });
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving Changes..." : "Commit District"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

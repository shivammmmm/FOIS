import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";

const DEFAULT_PAGE_SIZE = 50;

export default function StateMasterAdmin() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", active: true });
  const [saving, setSaving] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  const load = async () => {
    setLoading(true);
    try {
      // Swapped legacy generic implementation for high-performance direct endpoints
      const res = await apiClient.stateMaster.list({
        search,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
      
      const items = Array.isArray(res) ? res : res?.items || [];
      const t = res?.total ?? items.length;
      
      setRows(items);
      setTotal(t || 0);
    } catch (err) {
      console.error("Failed to load state parameters:", err);
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
  }, [search, page]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", code: "", active: true });
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({ 
      name: row?.name || "", 
      code: row?.code || "", 
      active: row?.active !== false 
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = String(form.name || "").trim();
    
    // Deterministic upper-case alpha token generation if explicit code isn't passed
    let code = String(form.code || "").trim().toUpperCase();
    if (!code && name) {
      code = name.replace(/\s+/g, "_").toUpperCase();
    }

    if (!name) return alert("State name is required");
    if (!code) return alert("State code identifier is required");

    try {
      setSaving(true);
      const payload = {
        code,
        name,
        active: !!form.active,
      };

      if (editing?.id) {
        // Safe modification sequence mapping
        await apiClient.stateMaster.update(editing.id, payload);
      } else {
        // Direct table configuration instantiation
        await apiClient.stateMaster.save(payload);
      }

      setShowForm(false);
      setEditing(null);
      setForm({ name: "", code: "", active: true });
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || e?.message || "Failed to save state entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    const ok = window.confirm(`Are you sure you want to delete state "${row?.name}"?\nThis action will fail if active stations depend on this master boundary record.`);
    if (!ok) return;
    try {
      setSaving(true);
      await apiClient.stateMaster.delete(row?.id || `state_master_${row?.code}`);
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || e?.message || "Failed to clear state bounds from db structure");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">State Master</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage global territorial bounds for Indian Railway networks
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> Add State
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[280px] bg-muted border border-border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search state code / name markers..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <X
              className="w-3.5 h-3.5 text-muted-foreground cursor-pointer"
              onClick={() => setSearch("")}
            />
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['State Name', 'State Code', 'Status Indicator', ''].map((h) => (
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
                  <td
                    colSpan={4}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {search
                      ? "No matching state configuration entries located inside DB cluster."
                      : "No state tables populated yet."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r?.id || r?.code}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{r?.name || "-"}</td>
                    <td className="px-4 py-3 font-mono text-sm font-bold text-primary">
                      {r?.code || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        r?.active !== false 
                          ? "bg-emerald-500/10 text-emerald-500" 
                          : "bg-red-500/10 text-red-500"
                      }`}>
                        {r?.active === false ? "Inactive Blocked" : "Active Pool"}
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

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-lg bg-card border border-border rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {editing ? "Edit State Registry" : "Register New State"}
                </h2>
                <p className="text-xs text-muted-foreground">Setup explicit state validation arguments</p>
              </div>
              <button
                className="px-2 py-1 rounded-lg border border-border bg-card hover:bg-muted/30 text-xs font-semibold"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ name: "", code: "", active: true });
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-4 mt-5">
              <label className="block space-y-1">
                <div className="text-xs font-medium text-muted-foreground">State Full Name *</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Telangana, West Bengal"
                />
              </label>

              <label className="block space-y-1">
                <div className="text-xs font-medium text-muted-foreground">State Code Identifier *</div>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary font-mono uppercase"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g., TG, WB, MP"
                  disabled={!!editing}
                />
              </label>

              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  className="rounded border-border bg-background text-primary"
                  checked={!!form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                <span className="text-xs font-medium text-muted-foreground select-none">Include in operational station master pool</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 border-t border-border pt-4">
              <button
                className="px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted/30 text-sm font-medium"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                  setForm({ name: "", code: "", active: true });
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
                {saving ? "Saving Changes..." : "Commit Record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
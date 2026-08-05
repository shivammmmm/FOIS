import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import StatusBadge from "@/components/StatusBadge";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Trash2,
  X,
  Zap,
  Search,
  RefreshCw,
  Layers,
} from "lucide-react";

const numberFormatter = new Intl.NumberFormat("en-IN");

function formatCount(value) {
  const parsed = Number(value);
  return numberFormatter.format(Number.isFinite(parsed) ? parsed : 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fileNameOf(upload) {
  return upload?.original_file_name || upload?.file_name || "-";
}

function recordCountOf(upload) {
  return (
    upload?.record_count ??
    upload?.records_valid ??
    upload?.insertedRecords ??
    0
  );
}

export default function UploadHistory() {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [confirmUpload, setConfirmUpload] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadUploads();
  }, []);

  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalRowsProcessed = 0;
    let todayCount = 0;
    let totalTimeMs = 0;

    for (const u of uploads) {
      const uDate = (u.uploaded_at || u.upload_time || "").split("T")[0];
      if (uDate === todayStr) todayCount++;

      const ins = Number(u.insertedRecords ?? u.record_count ?? 0);
      const upd = Number(u.updatedRecords ?? u.updated_count ?? 0);
      const skp = Number(u.skippedRecords ?? u.skipped_count ?? 0);
      const parsed = Number(u.records_parsed ?? u.record_count ?? 0);
      const duration = Number(u.processing_time_ms ?? u.duration_ms ?? 0);

      totalInserted += ins;
      totalUpdated += upd;
      totalSkipped += skp;
      totalRowsProcessed += parsed;
      totalTimeMs += duration;
    }

    const avgSpeed =
      totalTimeMs > 0
        ? Math.round((totalRowsProcessed / (totalTimeMs / 1000)) * 10) / 10
        : 0;

    return {
      totalUploads: uploads.length,
      todayCount,
      totalRowsProcessed,
      totalInserted,
      totalUpdated,
      totalSkipped,
      avgSpeed,
    };
  }, [uploads]);

  const filteredUploads = useMemo(() => {
    if (!searchQuery.trim()) return uploads;
    const query = searchQuery.toLowerCase().trim();
    return uploads.filter(
      (u) =>
        fileNameOf(u).toLowerCase().includes(query) ||
        (u.batch_id || "").toLowerCase().includes(query) ||
        (u.uploaded_by || "").toLowerCase().includes(query) ||
        (u.source || "").toLowerCase().includes(query)
    );
  }, [uploads, searchQuery]);

  const loadUploads = async () => {
    setLoading(true);
    setError("");
    try {
      setUploads(await base44.admin.uploadHistory.list({ limit: 200 }));
    } catch (err) {
      console.error(err);
      setError(err?.message || "Unable to load upload history");
    } finally {
      setLoading(false);
    }
  };

  const deleteUpload = async () => {
    if (!confirmUpload) return;
    setDeletingId(confirmUpload.id);
    setError("");
    setNotice(null);

    try {
      const result = await base44.admin.uploadHistory.delete(confirmUpload.id);
      setUploads((prev) =>
        prev.filter(
          (upload) =>
            upload.id !== confirmUpload.id &&
            upload.batch_id !== confirmUpload.batch_id
        )
      );
      setNotice({
        type: "success",
        text: `Deleted ${formatCount(
          (result?.deleted_counts?.freight_movements || 0) +
            (result?.deleted_counts?.matured_indents || 0)
        )} imported records for ${result?.batch_id || confirmUpload.batch_id}.`,
      });
      setConfirmUpload(null);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Unable to delete upload");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-card via-card/80 to-primary/5 p-6 rounded-2xl border border-border/80 shadow-xs backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <History className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Upload History & Diagnostics
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
            {formatCount(stats.totalUploads)} total uploads logged, {formatCount(stats.totalRowsProcessed)} total rows ingested
          </p>
        </div>

        <button
          onClick={loadUploads}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60 transition-all cursor-pointer shadow-xs"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 text-primary" />
          )}
          Refresh Logs
        </button>
      </div>

      {/* Enterprise Statistics Cards Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Total Uploads</div>
          <div className="mt-1 text-xl font-extrabold text-foreground">{formatCount(stats.totalUploads)}</div>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Today's Uploads</div>
          <div className="mt-1 text-xl font-extrabold text-foreground">{formatCount(stats.todayCount)}</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-xs">
          <div className="text-xs font-semibold text-emerald-400">Rows Inserted</div>
          <div className="mt-1 text-xl font-extrabold text-emerald-400">{formatCount(stats.totalInserted)}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-xs">
          <div className="text-xs font-semibold text-amber-400">Rows Updated</div>
          <div className="mt-1 text-xl font-extrabold text-amber-400">{formatCount(stats.totalUpdated)}</div>
        </div>
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-xs">
          <div className="text-xs font-semibold text-blue-400">Rows Skipped</div>
          <div className="mt-1 text-xl font-extrabold text-blue-400">{formatCount(stats.totalSkipped)}</div>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-xs">
          <div className="text-xs font-semibold text-primary">Avg Speed</div>
          <div className="mt-1 flex items-center gap-1 text-xl font-extrabold text-primary">
            <Zap className="w-4 h-4 fill-primary" />
            {stats.avgSpeed} r/s
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          {notice.text}
        </div>
      ) : null}

      {/* Main Table Card */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Table Header Filter Toolbar */}
        <div className="px-5 py-4 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-foreground text-base">Execution Logs</h3>
            <span className="text-xs text-muted-foreground ml-2">Showing {filteredUploads.length} entries</span>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search filename, batch, user or source..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/80 bg-muted/30">
                {[
                  "File / Payload Name",
                  "Zone",
                  "Version",
                  "Source",
                  "Batch ID",
                  "Upload Date",
                  "Parsed",
                  "Valid",
                  "Duplicates",
                  "Real Added",
                  "Status",
                  "Actions",
                ].map((header) => (
                  <th
                    key={header}
                    className="px-4 py-3 text-left font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border/50">
                    {[...Array(12)].map((_, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredUploads.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No upload history logs found.
                  </td>
                </tr>
              ) : (
                filteredUploads.map((upload) => (
                  <tr
                    key={upload.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 max-w-xs truncate font-semibold text-foreground">
                      {fileNameOf(upload)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                        {upload.zone || "ALL"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-primary whitespace-nowrap">
                      v{upload.version_number || 1}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          upload.source === "Paste"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        }`}
                      >
                        {upload.source || "Excel"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                      {upload.batch_id || "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(upload.uploaded_at || upload.upload_time)}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-foreground whitespace-nowrap">
                      {formatCount(upload.records_parsed ?? upload.record_count ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-emerald-400 whitespace-nowrap">
                      {formatCount(upload.records_valid ?? upload.record_count ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {upload.duplicates_found > 0 ? (
                        <span className="text-orange-400 font-semibold">
                          {formatCount(upload.duplicates_found)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-extrabold text-emerald-400 whitespace-nowrap">
                      +{formatCount(upload.real_added ?? Math.max(0, (upload.records_valid ?? upload.record_count ?? 0) - (upload.duplicates_found ?? 0)))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={upload.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedUpload(upload)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
                          title="View Upload Details"
                          aria-label="View upload"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmUpload(upload)}
                          disabled={deletingId === upload.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60 cursor-pointer transition-colors"
                          title="Delete Upload Entry"
                          aria-label="Delete upload"
                        >
                          {deletingId === upload.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
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

      {selectedUpload ? (
        <UploadDetailsModal
          upload={selectedUpload}
          onClose={() => setSelectedUpload(null)}
        />
      ) : null}

      {confirmUpload ? (
        <DeleteConfirmModal
          upload={confirmUpload}
          deleting={deletingId === confirmUpload.id}
          onCancel={() => setConfirmUpload(null)}
          onDelete={deleteUpload}
        />
      ) : null}
    </div>
  );
}

function UploadDetailsModal({ upload, onClose }) {
  const details = [
    ["File", fileNameOf(upload)],
    ["Source", upload.source || "Excel"],
    ["Version", `Version ${upload.version_number || 1}`],
    ["Batch ID", upload.batch_id || "-"],
    ["Type", upload.file_type || "-"],
    ["Upload Date", formatDate(upload.uploaded_at || upload.upload_time)],
    ["Uploaded By", upload.uploaded_by || "-"],
    ["Total Parsed Rows", formatCount(upload.records_parsed || upload.records_valid)],
    ["Valid Rows", formatCount(upload.records_valid ?? upload.record_count ?? 0)],
    ["Duplicates DB Skipped", formatCount(upload.duplicates_found ?? 0)],
    ["Real Value Added (Net New)", formatCount(upload.real_added ?? Math.max(0, (upload.records_valid ?? 0) - (upload.duplicates_found ?? 0)))],
    ["Inserted (New)", formatCount(upload.insertedRecords ?? upload.record_count ?? 0)],
    ["Updated", formatCount(upload.updatedRecords ?? upload.updated_count ?? 0)],
    ["Skipped (Unchanged)", formatCount(upload.skippedRecords ?? upload.skipped_count ?? 0)],
    ["Duplicates Inside File", formatCount(upload.duplicate_rows_in_file ?? 0)],
    ["Duplicates DB Skipped", formatCount(upload.duplicates_found ?? 0)],
    ["Notifications Sent", formatCount(upload.notifications_count ?? 0)],
    ["Processing Time", upload.processing_time_ms ? `${upload.processing_time_ms} ms` : "-"],
  ];

  const warnings = Array.isArray(upload.warnings) ? upload.warnings : [];
  const timeline = upload.stage_timeline || {};

  const handleDownloadReport = () => {
    window.open(`/api/admin/upload-history/${upload.id || upload.batch_id}/warnings-report`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl my-auto animate-scale-in">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-foreground text-base">Upload Diagnostics & Stage Timeline</h2>
              <p className="text-xs text-muted-foreground">Batch: {upload.batch_id || '-'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
            title="Close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Metadata Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5"
              >
                <div className="text-[11px] text-muted-foreground font-medium">{label}</div>
                <div className="mt-0.5 truncate font-bold text-foreground">
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Stage Timeline */}
          {Object.keys(timeline).length > 0 ? (
            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-2 text-xs">
              <div className="text-[11px] font-bold text-foreground uppercase tracking-wider">
                Execution Stage Timeline
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {Object.entries(timeline).map(([stage, time]) => (
                  <div key={stage} className="rounded-lg bg-card border border-border/60 p-2.5">
                    <div className="capitalize font-medium text-muted-foreground">{stage.replace(/_/g, " ")}</div>
                    <div className="text-foreground font-bold mt-0.5">{formatDate(time)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Warnings List */}
          {warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 font-bold uppercase tracking-wider text-[11px]">
                  <AlertTriangle className="w-4 h-4" />
                  Validation Warnings ({warnings.length})
                </div>
                <button
                  onClick={handleDownloadReport}
                  className="inline-flex items-center gap-1 text-xs text-amber-300 hover:underline font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Warning Report
                </button>
              </div>
              <ul className="list-disc list-inside text-xs text-amber-200/90 space-y-1">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ upload, deleting, onCancel, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-scale-in">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base">Delete Upload Records</h3>
            <p className="text-xs text-muted-foreground">Batch: {upload?.batch_id}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to permanently delete <strong>{fileNameOf(upload)}</strong>?
          This will permanently delete all imported movement records associated with this upload batch.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors shadow-sm"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
}

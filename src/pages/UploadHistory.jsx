import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import StatusBadge from "@/components/StatusBadge";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Trash2,
  X,
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

  useEffect(() => {
    loadUploads();
  }, []);

  const totalRecords = useMemo(
    () =>
      uploads.reduce(
        (sum, upload) => sum + Number(recordCountOf(upload) || 0),
        0
      ),
    [uploads]
  );

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
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">
              Upload History
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {formatCount(uploads.length)} uploads, {formatCount(totalRecords)}{" "}
            imported records
          </p>
        </div>
        <button
          onClick={loadUploads}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <History className="w-4 h-4" />
          )}
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          {notice.text}
        </div>
      ) : null}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  "File Name",
                  "Batch ID",
                  "Upload Date",
                  "Uploaded By",
                  "Total Records",
                  "Status",
                  "Actions",
                ].map((header) => (
                  <th
                    key={header}
                    className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
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
                    {[...Array(7)].map((_, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : uploads.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No upload history found.
                  </td>
                </tr>
              ) : (
                uploads.map((upload) => (
                  <tr
                    key={upload.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 max-w-sm truncate font-medium text-foreground">
                      {fileNameOf(upload)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {upload.batch_id || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(upload.uploaded_at || upload.upload_time)}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
                      {upload.uploaded_by || "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                      {formatCount(recordCountOf(upload))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={upload.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedUpload(upload)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="View"
                          aria-label="View upload"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmUpload(upload)}
                          disabled={deletingId === upload.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60"
                          title="Delete"
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
          onDelete={() => {
            setConfirmUpload(selectedUpload);
            setSelectedUpload(null);
          }}
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

function UploadDetailsModal({ upload, onClose, onDelete }) {
  const details = [
    ["File", fileNameOf(upload)],
    ["Batch ID", upload.batch_id || "-"],
    ["Type", upload.file_type || "-"],
    ["Upload Date", formatDate(upload.uploaded_at || upload.upload_time)],
    ["Uploaded By", upload.uploaded_by || "-"],
    ["Total Records", formatCount(recordCountOf(upload))],
    ["Parsed Rows", formatCount(upload.records_parsed)],
    ["Failed Rows", formatCount(upload.records_failed)],
    ["Duplicates", formatCount(upload.duplicates_found)],
    ["Missing ODR", formatCount(upload.missing_odrs_found)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Upload Details</h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-background/40 px-3 py-2"
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 truncate text-sm font-medium text-foreground">
                {value}
              </div>
            </div>
          ))}
          {(upload.error_details || upload.notes) ? (
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2 sm:col-span-2">
              <div className="text-xs text-muted-foreground">Notes</div>
              <div className="mt-1 text-sm text-foreground">
                {upload.error_details || upload.notes}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Close
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ upload, deleting, onCancel, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="mt-0.5 rounded-lg bg-red-500/10 p-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">
              Delete uploaded file?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This will permanently delete all imported records from this upload.
            </p>
          </div>
        </div>
        <div className="px-5 py-4 text-sm">
          <div className="font-medium text-foreground truncate">
            {fileNameOf(upload)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {upload.batch_id || "-"} - {formatCount(recordCountOf(upload))}{" "}
            records
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

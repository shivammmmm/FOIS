import { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

export default function UploadCenter() {
  const [uploading, setUploading] = useState(false);
  const [fileType, setFileType] = useState('ODR');
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await base44.admin.uploadHistory.list({ limit: 30 });
      setLogs(data);
    } catch (e) { console.error(e); }
    setLoadingLogs(false);
  };

  const processFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const fileBase64 = await readFileAsBase64(file);
      const result = await base44.admin.uploads.excel({
        fileName: file.name,
        fileType,
        fileBase64,
      });

      setUploadResult(result);
      loadLogs();

    } catch (err) {
      setUploadResult({ success: false, message: err.message });
      loadLogs();
    }
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleDeleteLog = async (log) => {
    const confirmed = window.confirm(
      'Delete uploaded file?\n\nThis will permanently delete all imported records from this upload.'
    );
    if (!confirmed) return;
    await base44.admin.uploadHistory.delete(log.id);
    loadLogs();
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Center</h1>
        <p className="text-muted-foreground text-sm mt-1">Upload FOIS Excel files to update freight intelligence</p>
      </div>

      {/* Upload Zone */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* File type selector */}
          <div className="flex gap-3">
            {['ODR', 'MaturedIndent'].map(type => (
              <button
                key={type}
                onClick={() => setFileType(type)}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-all ${
                  fileType === type
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground'
                }`}
              >
                {type === 'ODR' ? '🚆 ODR Data' : '📋 Matured Indent'}
              </button>
            ))}
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Processing file...</p>
              </div>
            ) : (
              <>
                <FileSpreadsheet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">Drop your {fileType === 'ODR' ? 'ODR' : 'Matured Indent'} Excel file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse — .xlsx, .xls, .csv supported</p>
              </>
            )}
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={e => processFile(e.target.files[0])} />
          </div>
        </div>

        {/* Instructions + Result */}
        <div className="space-y-4">
          {uploadResult ? (
            <div className={`rounded-xl border p-5 ${uploadResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <div className="flex items-center gap-2 mb-3">
                {uploadResult.success ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
                <h3 className="font-semibold text-foreground">{uploadResult.success ? 'Upload Successful' : 'Upload Failed'}</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{uploadResult.message}</p>
              {uploadResult.success && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Records Parsed', uploadResult.records_parsed],
                    ['Valid Records', uploadResult.records_valid],
                    ['Failed Rows', uploadResult.records_failed],
                    ['Duplicates', uploadResult.duplicates_found],
                    ['Missing ODR Alerts', uploadResult.missing_odrs_found],
                    ['Batch ID', uploadResult.batch_id],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-muted/40 rounded-lg p-2">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="font-semibold text-foreground mt-0.5 truncate">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-foreground">Upload Instructions</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                {[
                  { step: '1', text: 'Select file type: ODR or Matured Indent', icon: '📁' },
                  { step: '2', text: 'Upload .xlsx file — supports multiple sheets (all sheets processed automatically)', icon: '📤' },
                  { step: '3', text: 'System parses and validates all records', icon: '🔍' },
                  { step: '4', text: 'ODR vs Indent comparison runs automatically', icon: '⚖️' },
                  { step: '5', text: 'Dashboard and alerts update instantly', icon: '🔔' },
                ].map(s => (
                  <div key={s.step} className="flex items-start gap-3">
                    <span className="text-base">{s.icon}</span>
                    <span>{s.text}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-amber-400">Column mapping:</strong> System auto-detects FOIS column headers. Supported: ODR NO, ZONE, DIVISION, FROM, TO, COMMODITY, RAKE TYPE, WAGONS, ARRIVAL, DEPARTURE, STATUS.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload History */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Upload History</h3>
          <span className="text-xs text-muted-foreground">{logs.length} uploads</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['File', 'Type', 'Time', 'Parsed', 'Valid', 'Duplicates', 'Missing ODR', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(9)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No uploads yet. Upload your first FOIS file above.</td></tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 max-w-xs truncate font-medium text-foreground text-xs">{log.file_name}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${log.file_type === 'ODR' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {log.file_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {log.upload_time ? new Date(log.upload_time).toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">{log.records_parsed}</td>
                    <td className="px-4 py-3 text-center text-emerald-400">{log.records_valid}</td>
                    <td className="px-4 py-3 text-center">
                      {log.duplicates_found > 0 ? <span className="text-orange-400 font-medium">{log.duplicates_found}</span> : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.missing_odrs_found > 0 ? <span className="text-red-400 font-medium">{log.missing_odrs_found}</span> : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDeleteLog(log)} className="text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}

import { useState, useRef, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Eye,
  X,
  ArrowRight,
  ClipboardList,
  RotateCcw,
  Upload,
  Sparkles,
  Search,
  FileCode2,
  Hash,
  AlignLeft,
  Rows3,
  Layers,
  Zap,
  Info,
  MapPin,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { parsePastedTextToAOA, createExcelFileFromText } from '@/utils/pastedFoisParser';

const ADMIN_ROLES = ['super_admin', 'admin'];

const RAILWAY_ZONES = [
  { code: 'ALL', name: 'All Zones (General)' },
  { code: 'SCoR', name: 'SCoR / SCOR - South Coast Railway' },
  { code: 'CR', name: 'CR - Central Railway' },
  { code: 'WR', name: 'WR - Western Railway' },
  { code: 'NR', name: 'NR - Northern Railway' },
  { code: 'SR', name: 'SR - Southern Railway' },
  { code: 'SCR', name: 'SCR - South Central Railway' },
  { code: 'SER', name: 'SER - South Eastern Railway' },
  { code: 'SECR', name: 'SECR - South East Central Railway' },
  { code: 'ER', name: 'ER - Eastern Railway' },
  { code: 'ECR', name: 'ECR - East Central Railway' },
  { code: 'ECoR', name: 'ECoR - East Coast Railway' },
  { code: 'WCR', name: 'WCR - West Central Railway' },
  { code: 'NWR', name: 'NWR - North Western Railway' },
  { code: 'NCR', name: 'NCR - North Central Railway' },
  { code: 'NER', name: 'NER - North Eastern Railway' },
  { code: 'NFR', name: 'NFR - Northeast Frontier Railway' },
  { code: 'SWR', name: 'SWR - South Western Railway' },
  { code: 'KR', name: 'KR - Konkan Railway' },
  { code: 'MR', name: 'MR - Metro Railway Kolkata' },
];

const SAMPLE_ODR_TSV = `S.NO.\tDVSN\tSTTN FROM\tNO.\tDATE\tTIME\tEXPECTED LOADING DATE\tCNSR\tCNSG\tCMDT\tPRODUCT\tTT\tPC\tPBF\tVIA\tRAKE CMDT\tWAGON TYPE\tDSTN\tTYPE\tINDENTED UNTS\tINDENTED 8W\tOTSG UNTS\tOTSG 8W\tSUPPLIED UNTS\tSUPPLIED TIME
1\tKGP\tHLDZ\t101\t01-08-2026\t10:00\t01-08-2026\tTISC\tTISC\tCOAL\tCOAL\t-\tC\t-\t-\tBOXN\tBOXN\tTATA\t-\t59\t59\t0\t0\t59\t01-08-2026 12:00
2\tKGP\tHLDZ\t102\t01-08-2026\t11:30\t01-08-2026\tSAIL\tSAIL\tIRON\tIRON\t-\tRM\t-\t-\tBOXN\tBOXN\tBSLB\t-\t59\t59\t0\t0\t59\t01-08-2026 14:00
3\tADA\tBJE\t103\t01-08-2026\t14:15\t02-08-2026\tTISC\tTISC\tCOAL\tCOAL\t-\tC\t-\t-\tBOBRN\tBOBRN\tDPS\t-\t59\t59\t0\t0\t0\t-`;

const SAMPLE_MATURED_CSV = `S.NO.,DVSN,STTN FROM,DEMAND NO.,DEMAND DATE,DEMAND TIME,EXPECTED LOADING DATE,CONSIGNOR,CNSG,CMDT,PRODUCT,TT,PC,PBF,VIA,RAKE CMDT,WAGON TYPE,DSTN,TYPE,INDENTED UNTS,INDENTED 8W,OTSG UNTS,OTSG 8W,SUPPLIED UNTS,SUPPLIED TIME
1,KGP,HLDZ,IND-2001,01-08-2026,09:00,01-08-2026,TISC,TISC,COAL,COAL,-,C,-,-,BOXN,BOXN,TATA,-,59,59,0,0,59,01-08-2026 11:30
2,KGP,HLDZ,IND-2002,01-08-2026,10:15,01-08-2026,SAIL,SAIL,IRON,IRON,-,RM,-,-,BOXN,BOXN,BSLB,-,59,59,0,0,59,01-08-2026 13:00`;

export default function UploadCenter() {
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const [activeTab, setActiveTab] = useState('excel'); // 'excel' | 'paste'
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadSource, setUploadSource] = useState('Excel'); // 'Excel' | 'Paste'
  const [fileType, setFileType] = useState('ODR');
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [historySearch, setHistorySearch] = useState('');

  // Paste feature state
  const [pastedText, setPastedText] = useState('');

  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await base44.admin.uploadHistory.list({ limit: 40 });
      setLogs(data);
    } catch (e) {
      console.error(e);
    }
    setLoadingLogs(false);
  };

  // Real-time metrics for pasted text
  const pasteStats = useMemo(() => {
    return parsePastedTextToAOA(pastedText);
  }, [pastedText]);

  // Filtered history logs
  const filteredLogs = useMemo(() => {
    if (!historySearch.trim()) return logs;
    const query = historySearch.toLowerCase().trim();
    return logs.filter(
      (l) =>
        (l.file_name || '').toLowerCase().includes(query) ||
        (l.batch_id || '').toLowerCase().includes(query) ||
        (l.source || '').toLowerCase().includes(query) ||
        (l.file_type || '').toLowerCase().includes(query) ||
        (l.zone || '').toLowerCase().includes(query)
    );
  }, [logs, historySearch]);

  const handleFileSelect = async (file) => {
    if (!file) return;
    setSelectedFile(file);
    setUploadSource('Excel');
    setPreviewing(true);
    setUploadResult(null);

    try {
      const preview = await base44.admin.uploads.excelPreview({
        fileName: file.name,
        fileType,
        file,
        source: 'Excel',
        zone: selectedZone,
      });
      setPreviewData(preview);
    } catch (err) {
      setPreviewData(null);
      setUploadResult({ success: false, message: err.message });
      setPreviewing(false);
      setSelectedFile(null);
    }
  };

  const handlePastedPreview = async () => {
    if (!pastedText || !pastedText.trim()) {
      setUploadResult({ success: false, message: 'Please paste FOIS data before clicking Preview.' });
      return;
    }

    setPreviewing(true);
    setUploadResult(null);

    try {
      const file = createExcelFileFromText(pastedText, fileType);
      setSelectedFile(file);
      setUploadSource('Paste');

      const preview = await base44.admin.uploads.excelPreview({
        fileName: file.name,
        fileType,
        file,
        source: 'Paste',
        zone: selectedZone,
      });

      setPreviewData(preview);
    } catch (err) {
      setPreviewData(null);
      setUploadResult({ success: false, message: err.message });
      setPreviewing(false);
      setSelectedFile(null);
    }
  };

  const handlePastedUploadDirect = async () => {
    if (!pastedText || !pastedText.trim()) {
      setUploadResult({ success: false, message: 'Please paste FOIS data before clicking Upload.' });
      return;
    }

    setUploading(true);
    setUploadResult(null);
    setPreviewData(null);

    try {
      const file = createExcelFileFromText(pastedText, fileType);
      setSelectedFile(file);
      setUploadSource('Paste');

      const result = await base44.admin.uploads.excel({
        fileName: file.name,
        fileType,
        file,
        source: 'Paste',
        zone: selectedZone,
      });

      setUploadResult(result);
      loadLogs();
    } catch (err) {
      setUploadResult({ success: false, message: err.message });
      loadLogs();
    } finally {
      setUploading(false);
      setSelectedFile(null);
    }
  };

  const commitUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setPreviewData(null);

    try {
      const result = await base44.admin.uploads.excel({
        fileName: selectedFile.name,
        fileType,
        file: selectedFile,
        source: uploadSource,
        zone: selectedZone,
      });

      setUploadResult(result);
      loadLogs();
    } catch (err) {
      setUploadResult({ success: false, message: err.message });
      loadLogs();
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setUploading(false);
      setSelectedFile(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDeleteLog = async (log) => {
    const confirmed = window.confirm(
      'Delete uploaded file?\n\nThis will permanently delete all imported records from this upload.'
    );
    if (!confirmed) return;
    await base44.admin.uploadHistory.delete(log.id);
    loadLogs();
  };

  const handleClearPaste = () => {
    setPastedText('');
    setUploadResult(null);
    setPreviewData(null);
  };

  const handleLoadSample = (sampleType) => {
    if (sampleType === 'ODR') {
      setFileType('ODR');
      setPastedText(SAMPLE_ODR_TSV);
    } else {
      setFileType('MaturedIndent');
      setPastedText(SAMPLE_MATURED_CSV);
    }
    setUploadResult(null);
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-7xl mx-auto">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-card via-card/80 to-primary/5 p-6 rounded-2xl border border-border/80 shadow-xs backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Upload className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Upload Center</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
            Ingest FOIS data via Excel uploads or raw text pasting with real-time pre-commit preview and incremental engine.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs text-muted-foreground">Total Ingested Uploads</span>
            <span className="text-lg font-bold text-foreground">{logs.length}</span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Bar */}
      <div className="flex items-center justify-between border-b border-border/70 pb-0">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('excel')}
            className={`flex items-center gap-2.5 px-5 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer rounded-t-xl ${
              activeTab === 'excel'
                ? 'border-primary text-primary bg-primary/10 shadow-xs'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Upload Excel
          </button>

          {isAdmin && (
            <button
              onClick={() => setActiveTab('paste')}
              className={`flex items-center gap-2.5 px-5 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer rounded-t-xl ${
                activeTab === 'paste'
                  ? 'border-primary text-primary bg-primary/10 shadow-xs'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              Paste FOIS Data
              <span className="ml-1 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1 shadow-2xs">
                <Sparkles className="w-2.5 h-2.5" />
                Test / Debug
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Interactive Input Source */}
        <div className="space-y-4">
          {/* File Type Toggle Selector */}
          <div className="flex items-center gap-2 p-1 bg-muted/40 rounded-xl border border-border/60">
            {[
              { id: 'ODR', label: '🚆 ODR Data', desc: 'Freight Movement' },
              { id: 'MaturedIndent', label: '📋 Matured Indent', desc: 'Demand Records' },
            ].map((type) => (
              <button
                key={type.id}
                onClick={() => setFileType(type.id)}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
                  fileType === type.id
                    ? 'bg-card text-primary shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{type.label}</span>
                <span className="text-[10px] text-muted-foreground font-normal hidden sm:inline">
                  {type.desc}
                </span>
              </button>
            ))}
          </div>

          {/* Railway Zone Selector Dropdown */}
          <div className="flex items-center justify-between gap-3 p-3 bg-gradient-to-r from-card to-primary/5 rounded-xl border border-border/70 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <label htmlFor="zone-select-dropdown" className="text-xs font-bold text-foreground block cursor-pointer">
                  Railway Zone (Save Tag)
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Select zone to tag upload batch for memory
                </span>
              </div>
            </div>

            <select
              id="zone-select-dropdown"
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-card border border-border text-primary focus:outline-hidden focus:ring-2 focus:ring-primary/40 shadow-xs cursor-pointer"
            >
              {RAILWAY_ZONES.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {activeTab === 'excel' ? (
            /* Drop zone (Excel Upload) */
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${
                dragOver
                  ? 'border-primary bg-primary/10 shadow-lg scale-[1.01]'
                  : 'border-border/80 bg-card hover:border-primary/50 hover:bg-muted/30 shadow-xs'
              }`}
            >
              {uploading || previewing ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  <p className="text-sm font-medium text-foreground">
                    {previewing ? 'Analyzing pre-commit preview...' : 'Processing incremental engine upload...'}
                  </p>
                </div>
              ) : (
                <div className="py-4 space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto border border-primary/20 shadow-xs">
                    <FileSpreadsheet className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-foreground">
                      Drop your {fileType === 'ODR' ? 'ODR' : 'Matured Indent'} Excel file here
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      or click to browse from device
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    {['.xlsx', '.xls', '.csv'].map((ext) => (
                      <span
                        key={ext}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-muted text-muted-foreground border border-border"
                      >
                        {ext}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
            </div>
          ) : (
            /* Paste FOIS Data Editor Window */
            <div className="bg-card border border-border/80 rounded-2xl shadow-xs overflow-hidden">
              {/* Terminal Header Bar */}
              <div className="px-4 py-3 bg-muted/40 border-b border-border/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                  </div>
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 ml-2">
                    <FileCode2 className="w-3.5 h-3.5 text-primary" />
                    Raw FOIS Input Editor ({fileType})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Sample Preset Loaders */}
                  <button
                    type="button"
                    onClick={() => handleLoadSample('ODR')}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all cursor-pointer"
                    title="Load sample ODR TSV data"
                  >
                    Preset: ODR TSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSample('MaturedIndent')}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all cursor-pointer"
                    title="Load sample Matured Indent CSV data"
                  >
                    Preset: Matured CSV
                  </button>
                </div>
              </div>

              {/* Code Area */}
              <div className="p-3">
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={`Paste raw TSV, CSV, or space-separated FOIS export data here...\n\nFormat Examples:\n• Tab-separated (copied directly from Excel grid)\n• Comma-separated (CSV exported from FOIS portal)\n• Space-separated FOIS report text file`}
                  className="w-full min-h-[260px] lg:min-h-[290px] p-3 rounded-xl border border-border/60 bg-background/80 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                />
              </div>

              {/* Real-time Stats Cards Grid */}
              <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                    <AlignLeft className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-medium">Characters</div>
                    <div className="text-sm font-bold text-foreground">{pasteStats.charCount.toLocaleString('en-IN')}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
                    <Rows3 className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-medium">Total Lines</div>
                    <div className="text-sm font-bold text-foreground">{pasteStats.lineCount.toLocaleString('en-IN')}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-primary/20 text-primary">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-primary uppercase font-semibold">Parsed Rows</div>
                    <div className="text-sm font-bold text-primary">{pasteStats.parsedRowCount.toLocaleString('en-IN')}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Hash className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground uppercase font-medium">Detected Format</div>
                    <div className="text-xs font-semibold text-foreground truncate">{pasteStats.detectedFormat}</div>
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="px-4 py-3 bg-muted/30 border-t border-border/80 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleClearPaste}
                  disabled={!pastedText || uploading || previewing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear Editor
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePastedPreview}
                    disabled={!pastedText.trim() || uploading || previewing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    Preview
                  </button>

                  <button
                    type="button"
                    onClick={handlePastedUploadDirect}
                    disabled={!pastedText.trim() || uploading || previewing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Execution Diagnostics / Output Result */}
        <div className="space-y-4">
          {uploadResult ? (
            <div
              className={`rounded-2xl border p-5 transition-all shadow-xs ${
                uploadResult.success
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-red-500/40 bg-red-500/5'
              }`}
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  {uploadResult.success ? (
                    <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-red-500/20 text-red-400">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-foreground text-base">
                      {uploadResult.success ? 'Upload Execution Completed' : 'Upload Failed'}
                    </h3>
                    <span className="text-xs text-muted-foreground">Source: {uploadSource}</span>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    uploadResult.success
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {uploadResult.success ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>

              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                {uploadResult.message || uploadResult.error}
              </p>

              {uploadResult.success && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    ['Batch ID', uploadResult.batch_id || '—'],
                    ['Zone & Version', `${uploadResult.zone || selectedZone} — Version ${uploadResult.version_number || 1}`],
                    ['Records Parsed', (uploadResult.records_parsed ?? uploadResult.records_valid ?? 0)?.toLocaleString('en-IN')],
                    ['New Records Added', `+${(uploadResult.real_added ?? uploadResult.new_indents_added ?? uploadResult.insertedRecords ?? 0)?.toLocaleString('en-IN')}`],
                    ['Supplied Status Added', `+${(uploadResult.supplied_status_updates ?? 0)?.toLocaleString('en-IN')}`],
                    ['Matured Status Added', `+${(uploadResult.matured_status_updates ?? 0)?.toLocaleString('en-IN')}`],
                    ['Total Updated', (uploadResult.updatedRecords ?? 0)?.toLocaleString('en-IN')],
                    ['Skipped (Unchanged)', (uploadResult.skippedRecords ?? uploadResult.duplicates_found ?? 0)?.toLocaleString('en-IN')],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-background/80 rounded-xl p-3 border border-border/60 shadow-2xs">
                      <div className="text-[11px] text-muted-foreground font-medium">{label}</div>
                      <div className="font-bold text-foreground mt-0.5 truncate text-xs">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border/80 rounded-2xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 border-b border-border/70 pb-3">
                <Zap className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-foreground">Incremental Upload Features</h3>
              </div>

              <div className="space-y-3 text-xs text-muted-foreground">
                {[
                  {
                    step: '1',
                    text: 'Pre-Commit Preview: Inspect estimated new, updated & skipped rows prior to DB commit.',
                    icon: '👁️',
                  },
                  {
                    step: '2',
                    text: 'Sequential Versioning: Automatically increments version numbers (e.g. Version 1, 2) per zone.',
                    icon: '🏷️',
                  },
                  {
                    step: '3',
                    text: 'Intra-File Deduplication: Automatically consolidates duplicate rows in the input payload.',
                    icon: '⚡',
                  },
                  {
                    step: '4',
                    text: 'Unified Pipeline: Both Excel files & pasted text use the identical parser & DB engine.',
                    icon: '🔄',
                  },
                  {
                    step: '5',
                    text: 'Safe Recovery: Error handling marks status FAILED so tasks never get stuck in RUNNING.',
                    icon: '🛡️',
                  },
                ].map((s) => (
                  <div key={s.step} className="flex items-start gap-3 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                    <span className="text-base">{s.icon}</span>
                    <span className="leading-relaxed">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pre-Commit Preview Modal */}
      {previewData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs px-4 py-6">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-5 animate-scale-in">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground text-lg">Pre-Commit Upload Preview</h2>
                  <p className="text-xs text-muted-foreground">Source: {uploadSource}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setPreviewData(null);
                  setSelectedFile(null);
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs bg-muted/40 p-3 rounded-xl border border-border/60">
                <span className="text-muted-foreground font-medium">Detected Zone & Version:</span>
                <span className="font-bold text-primary">
                  {previewData.detected_zone} — Version {previewData.next_version_number}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border/80 bg-muted/30 p-2.5 text-center">
                  <div className="text-[10px] text-muted-foreground font-medium">Total Parsed</div>
                  <div className="text-base font-bold text-foreground mt-0.5">{previewData.rows_parsed}</div>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-emerald-400 font-semibold">Estimated New</div>
                  <div className="text-base font-bold text-emerald-400 mt-0.5">+{previewData.estimated_new}</div>
                </div>
                <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-blue-400 font-semibold">Estimated Supplied</div>
                  <div className="text-base font-bold text-blue-400 mt-0.5">+{previewData.estimated_supplied_updates ?? 0}</div>
                </div>
                <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-purple-400 font-semibold">Estimated Matured</div>
                  <div className="text-base font-bold text-purple-400 mt-0.5">+{previewData.estimated_matured_updates ?? 0}</div>
                </div>
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-amber-400 font-semibold">Estimated Updated</div>
                  <div className="text-base font-bold text-amber-400 mt-0.5">{previewData.estimated_updated}</div>
                </div>
                <div className="rounded-xl border border-slate-500/40 bg-slate-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-slate-400 font-semibold">Estimated Skipped</div>
                  <div className="text-base font-bold text-slate-400 mt-0.5">{previewData.estimated_skipped}</div>
                </div>
              </div>

              {previewData.duplicate_rows_in_file > 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    Detected <strong>{previewData.duplicate_rows_in_file}</strong> duplicate rows inside the payload. They will be consolidated automatically.
                  </span>
                </div>
              ) : null}

              {Array.isArray(previewData.warnings) && previewData.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="font-semibold uppercase tracking-wider text-[10px]">
                    Validation Warnings ({previewData.warnings.length}):
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {previewData.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                onClick={() => {
                  setPreviewData(null);
                  setSelectedFile(null);
                }}
                className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel Upload
              </button>
              <button
                onClick={commitUpload}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm transition-all cursor-pointer"
              >
                Proceed Upload
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upload History Table Card */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-foreground text-base">Upload History & Diagnostics</h3>
            <span className="text-xs text-muted-foreground">{filteredLogs.length} uploads logged</span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search file, batch or source..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/80 bg-muted/30">
                {[
                  { label: 'File / Payload', align: 'text-left' },
                  { label: 'Zone', align: 'text-center' },
                  { label: 'Version', align: 'text-center' },
                  { label: 'Source', align: 'text-center' },
                  { label: 'Type', align: 'text-center' },
                  { label: 'Time', align: 'text-left' },
                  { label: 'Parsed', align: 'text-center' },
                  { label: 'Valid', align: 'text-center' },
                  { label: 'Duplicates', align: 'text-center' },
                  { label: 'New Added', align: 'text-center' },
                  { label: 'Supplied', align: 'text-center' },
                  { label: 'Matured', align: 'text-center' },
                  { label: 'Status', align: 'text-center' },
                ].map(({ label, align }) => (
                  <th
                    key={label}
                    className={`px-3 py-3 font-semibold text-muted-foreground whitespace-nowrap ${align}`}
                  >
                    {label}
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold text-muted-foreground whitespace-nowrap text-center sticky right-0 bg-card z-20 border-l border-border/60 shadow-xs">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loadingLogs ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(13)].map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                    <td className="px-3 py-3 sticky right-0 bg-card z-20 border-l border-border/60">
                      <div className="h-4 w-8 bg-muted rounded animate-pulse mx-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No upload history logs found matching query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="group border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 max-w-[160px] truncate font-semibold text-foreground" title={log.file_name}>
                      {log.file_name}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                        {log.zone || 'ALL'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold text-primary whitespace-nowrap">
                      v{log.version_number || 1}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          log.source === 'Paste'
                            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {log.source || 'Excel'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          log.file_type === 'ODR'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-purple-500/15 text-purple-400'
                        }`}
                      >
                        {log.file_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {log.upload_time ? new Date(log.upload_time).toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center text-foreground font-medium whitespace-nowrap">{log.records_parsed}</td>
                    <td className="px-3 py-2.5 text-center text-emerald-400 font-bold whitespace-nowrap">{log.records_valid}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {log.duplicates_found > 0 ? (
                        <span className="text-orange-400 font-semibold">{log.duplicates_found}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-extrabold text-emerald-500 whitespace-nowrap">
                      +{(log.new_indents_added ?? log.real_added ?? Math.max(0, (log.records_valid || 0) - (log.duplicates_found || 0)))}
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold whitespace-nowrap">
                      {(log.supplied_status_updates || 0) > 0 ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                          +{log.supplied_status_updates}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold whitespace-nowrap">
                      {(log.matured_status_updates || 0) > 0 ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                          +{log.matured_status_updates}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap sticky right-0 bg-card group-hover:bg-muted/90 transition-colors z-10 border-l border-border/60 shadow-xs">
                      <button
                        onClick={() => handleDeleteLog(log)}
                        className="p-1 rounded-lg text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors cursor-pointer"
                        title="Delete Upload Log"
                      >
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

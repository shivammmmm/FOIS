export default function StatusBadge({ status, size = 'sm' }) {
  const config = {
    Inward:       { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Inward' },
    Outward:      { cls: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Outward' },
    Arrived:      { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Arrived' },
    Departed:     { cls: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Departed' },
    'In Transit': { cls: 'bg-cyan-100 text-cyan-700 border-cyan-200', label: 'In Transit' },
    Pending:      { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Pending' },
    Delayed:      { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Delayed' },
    MissingODR:   { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Missing ODR' },
    DuplicateODR: { cls: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Duplicate ODR' },
    Completed:    { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Completed' },
    Success:      { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Success' },
    Failed:       { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Failed' },
    Partial:      { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Partial' },
    Unknown:      { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Unknown' },
    info:         { cls: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Info' },
    warning:      { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Warning' },
    error:        { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Error' },
  };

  const c = config[status] || config.Unknown;
  const padding = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${padding} ${c.cls}`}>
      {c.label}
    </span>
  );
}

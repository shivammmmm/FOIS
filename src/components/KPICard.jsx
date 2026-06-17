export default function KPICard({ title, value, subtitle, icon: Icon, color = 'blue', trend, alert }) {
  const colorMap = {
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    border: 'border-blue-200' },
    cyan:    { bg: 'bg-cyan-50',    icon: 'text-cyan-600',    border: 'border-cyan-200' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-200' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   border: 'border-amber-200' },
    red:     { bg: 'bg-red-50',     icon: 'text-red-600',     border: 'border-red-200' },
    orange:  { bg: 'bg-orange-50',  icon: 'text-orange-600',  border: 'border-orange-200' },
    purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  border: 'border-purple-200' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className={`bg-card border ${c.border} rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-all`}>
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center`}>
          {Icon && <Icon className={`w-4.5 h-4.5 ${c.icon}`} style={{ width: '1.1rem', height: '1.1rem' }} />}
        </div>
        {alert && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
            Alert
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground tabular-nums">{value ?? '—'}</div>
        <div className="text-xs text-muted-foreground mt-0.5 font-medium">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {trend && (
        <div className="text-xs text-muted-foreground border-t border-border pt-2">{trend}</div>
      )}
    </div>
  );
}
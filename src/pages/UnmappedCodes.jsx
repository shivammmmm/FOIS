import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, TrainFront, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";

export default function UnmappedCodes() {
  const navigate = useNavigate();
  const [data, setData] = useState({ stations: [], commodities: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    base44
      .unmappedSummary()
      .then(setData)
      .catch((err) => setError(err?.message || "Could not load unmapped codes"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h1 className="text-2xl font-bold text-foreground">Unmapped Codes</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Station and commodity codes seen in uploaded FOIS data that have no matching master record yet.
          Add the highest-volume ones first — that resolves the most rows.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <GapPanel
          icon={TrainFront}
          title="Stations"
          subtitle={`${data.stations.length} code${data.stations.length === 1 ? "" : "s"} without a Station Master entry`}
          rows={data.stations}
          loading={loading}
          onGoToMaster={() => navigate("/admin/master-management/station")}
          masterLabel="Go to Station Master"
        />
        <GapPanel
          icon={Package}
          title="Commodities"
          subtitle={`${data.commodities.length} code${data.commodities.length === 1 ? "" : "s"} without a Commodity Master entry`}
          rows={data.commodities}
          loading={loading}
          onGoToMaster={() => navigate("/admin/master-management/commodity")}
          masterLabel="Go to Commodity Master"
        />
      </div>
    </div>
  );
}

function GapPanel({ icon: Icon, title, subtitle, rows, loading, onGoToMaster, masterLabel }) {
  const maxCount = Math.max(1, ...rows.map((r) => r.occurrence_count || 0));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
          <div>
            <h2 className="font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGoToMaster}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          {masterLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing unmapped here — every code seen in uploads has a master record.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-2.5 font-mono text-xs font-medium text-foreground whitespace-nowrap">
                    {row.code}
                  </td>
                  <td className="w-full px-2 py-2.5">
                    <div className="h-1.5 rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-amber-500"
                        style={{ width: `${Math.round(((row.occurrence_count || 0) / maxCount) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {(row.occurrence_count || 0).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

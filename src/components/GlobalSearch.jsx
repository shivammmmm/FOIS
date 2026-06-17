import { useState, useRef, useEffect } from "react";
import { Search, Train, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getCommodityName, resolveCode } from "@/utils/railwayDictionary";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import { getMyStationCodes, isWatchedStationCode } from "@/utils/myStations";

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlyMyStations, setOnlyMyStations] = useState(false);
  const [watchCodes, setWatchCodes] = useState(new Set());
  const ref = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const loadWatchlist = async () => {
      if (!user?.id) return;
      try {
        const stations = await base44.entities.UserWatchlist.filter(
          { user_id: user.id },
          "-created_at",
          100
        );
        setWatchCodes(getMyStationCodes(stations));
      } catch (e) {
        console.error(e);
      }
    };
    loadWatchlist();
  }, [user?.id]);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const all = await base44.entities.FreightMovement.list(
          "-created_date",
          200
        );
        const q = query.toLowerCase();

        let filtered = all.filter(
          (r) =>
            r.odr_number?.toLowerCase().includes(q) ||
            r.station_from?.toLowerCase().includes(q) ||
            r.station_to?.toLowerCase().includes(q) ||
            r.division?.toLowerCase().includes(q) ||
            r.zone?.toLowerCase().includes(q) ||
            r.commodity?.toLowerCase().includes(q) ||
            getCommodityName(r.commodity)?.toLowerCase().includes(q) ||
            r.rake_type?.toLowerCase().includes(q)
        );

        if (onlyMyStations) {
          filtered = filtered.filter(
            (r) =>
              isWatchedStationCode(r.station_from, watchCodes) ||
              isWatchedStationCode(r.station_to, watchCodes)
          );
        }

        filtered = filtered.slice(0, 8);
        setResults(filtered);
        setOpen(true);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, onlyMyStations, watchCodes]);

  const handleSelect = (record) => {
    setOpen(false);
    setQuery("");

    const base = `${isAdmin ? "/admin/freight" : "/search"}?odr=${
      record.odr_number
    }`;
    const next = onlyMyStations ? `${base}&only_my_stations=true` : base;
    navigate(next);
  };

  return (
    <div ref={ref} className="relative max-w-md w-full">
      <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search station, division, commodity, rack..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
        />
        {query && (
          <X
            className="w-3.5 h-3.5 text-muted-foreground cursor-pointer"
            onClick={() => setQuery("")}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 select-none">
        <input
          type="checkbox"
          checked={onlyMyStations}
          onChange={(e) => setOnlyMyStations(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        Only My Stations
        <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-primary font-semibold">
          ⭐ Watched Station
        </span>
      </label>

      {open && (results.length > 0 || loading) && (
        <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {loading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Searching...
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelect(r)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
            >
              <Train className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {r.odr_number} — {r.station_from} → {r.station_to}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.division} · {getCommodityName(r.commodity)} ·{" "}
                  {resolveCode(r.rake_type)}
                </div>
              </div>
              <MovementBadge type={r.movement_type} />
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No records found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MovementBadge({ type }) {
  const colors = {
    Inward: "bg-emerald-100 text-emerald-700",
    Outward: "bg-blue-100 text-blue-700",
    Unknown: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`ml-auto text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
        colors[type] || colors.Unknown
      }`}
    >
      {type}
    </span>
  );
}

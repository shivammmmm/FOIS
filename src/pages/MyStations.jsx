import { useEffect, useState, useRef } from "react";
import { MapPin, Plus, Trash2, Search, X, Star } from "lucide-react";
import { apiClient } from "@/api/apiClient"; // Wired directly to our safe native client wrapper
import { useAuth } from "@/lib/AuthContext";

export default function MyStations() {
  const { user } = useAuth();
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);

  // Autocomplete UI Searching States
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const dropdownRef = useRef(null);

  // Load the authenticated user's current watchlist parameters
  const loadWatchlist = async () => {
    if (!user?.id) return;
    try {
      // Direct call using the entities generic list interceptor fallback built in our apiClient
      const data = await apiClient.entities.list("UserWatchlist", {
        filter: JSON.stringify({ user_id: user.id }),
        sort: "-created_date"
      });
      setWatchlist(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to sync structural watchlist streams:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Real-time server-side station master suggestions query handler
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setSearchingSuggestions(true);
      try {
        const res = await apiClient.stationMaster.list({
          search: searchQuery,
          limit: 8,
          offset: 0
        });
        setSuggestions(res?.items || []);
      } catch (err) {
        console.error("Suggestions retrieval failure:", err);
      } finally {
        setSearchingSuggestions(false);
      }
    }, 300); // 300ms debounce loop for optimizing server performance

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Close suggestions when user clicks anywhere outside the card focus boundaries
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddStation = async () => {
    if (!selectedStation) {
      alert("Please select a station from the autocomplete suggestions drop array.");
      return;
    }

    // Guard constraint: Prevent duplication inside user matrix context
    const isAlreadySaved = watchlist.some(
      (item) => item.station_code.toUpperCase() === selectedStation.station_code.toUpperCase()
    );

    if (isAlreadySaved) {
      alert(`Station ${selectedStation.station_code} is already in your favorites pool.`);
      return;
    }

    try {
      await apiClient.entities.create("UserWatchlist", {
        user_id: user.id,
        station_code: selectedStation.station_code.toUpperCase(),
        station_name: selectedStation.station_name,
      });

      // Clear layout elements
      setSearchQuery("");
      setSelectedStation(null);
      setShowDropdown(false);
      await loadWatchlist();
    } catch (err) {
      console.error(err);
      alert("Failed to append configuration profile to watchlist database.");
    }
  };

  const handleDeleteStation = async (id) => {
    try {
      await apiClient.entities.delete("UserWatchlist", id);
      await loadWatchlist();
    } catch (err) {
      console.error(err);
      alert("Relational entity clear execution failed.");
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Dynamic Header Workspace */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
          <Star className="h-5 w-5 text-primary fill-primary/20" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Favorite Stations Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your high-priority personalized station watchlist grids
          </p>
        </div>
      </div>

      {/* --- Upgraded Real-time Searchable Autocomplete Control Panel --- */}
      <div className="bg-card border border-border rounded-xl shadow-sm p-5 max-w-3xl">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Search Master Registry & Bookmark Siding
        </h3>
        
        <div className="flex flex-col sm:flex-row gap-3 relative" ref={dropdownRef}>
          <div className="flex-1 relative">
            <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 focus-within:border-primary/50 transition-colors">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Type station name or alpha-code identifier (e.g. DURG, BSP)..."
                value={selectedStation ? `${selectedStation.station_name} (${selectedStation.station_code})` : searchQuery}
                onChange={(e) => {
                  if (selectedStation) setSelectedStation(null);
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
              />
              {(searchQuery || selectedStation) && (
                <X
                  className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedStation(null);
                    setSuggestions([]);
                  }}
                />
              )}
            </div>

            {/* suggestions dynamic drop dropdown box container layout */}
            {showDropdown && (searchQuery.trim().length >= 2 || searchingSuggestions) && (
              <div className="absolute top-full left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50 divide-y divide-border/40">
                {searchingSuggestions && (
                  <div className="p-3 text-xs text-primary animate-pulse font-medium">
                    Scanning centralized railway registries...
                  </div>
                )}
                {!searchingSuggestions && suggestions.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    No stations found matching these parameters.
                  </div>
                )}
                {!searchingSuggestions && suggestions.map((stn) => (
                  <div
                    key={stn.id || stn.station_code}
                    className="p-3 text-sm text-foreground hover:bg-muted/60 cursor-pointer flex items-center justify-between transition-colors"
                    onClick={() => {
                      setSelectedStation(stn);
                      setShowDropdown(false);
                    }}
                  >
                    <span className="font-medium text-foreground">{stn.station_name}</span>
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {stn.station_code}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleAddStation}
            className="flex items-center justify-center gap-2 px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Bookmark Station
          </button>
        </div>
      </div>

      {/* --- Upgraded Interactive Chips/Cards Workspace Grid System Layout --- */}
      <div className="space-y-3">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider pl-1">
          Active Monitored Pool Constraints ({watchlist.length} Stations)
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted border border-border/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : watchlist.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center max-w-3xl">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <div className="text-sm font-semibold text-foreground">Watchlist is empty</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Bookmark important high-frequency industrial siding points to fuel real-time intelligence feeds.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {watchlist.map((station) => (
              <div
                key={station.id}
                className="group relative flex items-start justify-between p-4 bg-card border border-border hover:border-primary/30 rounded-xl shadow-sm hover:shadow transition-all animate-fade-in"
              >
                <div className="space-y-1.5 min-w-0 pr-6">
                  <div className="flex items-center gap-1.5 text-primary">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-mono text-xs font-black tracking-wider uppercase">
                      {station.station_code}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-foreground leading-tight truncate" title={station.station_name}>
                    {station.station_name}
                  </h4>
                </div>

                {/* Mutation execution deletion overlay button links */}
                <button
                  onClick={() => handleDeleteStation(station.id)}
                  className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all absolute top-2 right-2"
                  title={`Remove ${station.station_code} from favorites`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
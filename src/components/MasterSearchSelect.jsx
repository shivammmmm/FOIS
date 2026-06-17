import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown } from "lucide-react";

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function MasterSearchSelect({
  label,
  value,
  onChange,
  master,
  apiClient,
  disabled,
  placeholder = "Type to search...",
  allowClear = true,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState([]);

  const rootRef = useRef(null);
  const debounced = useDebouncedValue(query, 180);

  const isSelected = value && typeof value === "object" && value.code;

  const selectedText = useMemo(() => {
    if (!isSelected) return "";
    return value.name || value.readable_name || value.code;
  }, [isSelected, value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        const res = await apiClient.masters.search(master, { search: debounced, limit: 20 });
        if (cancelled) return;
        const list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        setOptions(list);
      } catch {
        if (cancelled) return;
        setOptions([]);
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }

    if ((debounced || "").trim().length === 0) {
      // For better UX, show top options when opening.
      run();
    } else {
      run();
    }

    return () => {
      cancelled = true;
    };
  }, [open, debounced, apiClient, master]);

  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const showInputValue = open ? query : selectedText;

  return (
    <div className="space-y-1">
      {label && <div className="text-xs text-muted-foreground">{label}</div>}

      <div ref={rootRef} className="relative">
        <button
          type="button"
          className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none flex items-center justify-between gap-2 ${
            disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          }`}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
            if (!open) setQuery("");
          }}
          aria-label={label || "master selector"}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="text-foreground text-sm truncate">
              {isSelected ? selectedText : placeholder}
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>

        {open && (
          <div className="absolute z-40 mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="Search..."
                  value={query}
                  disabled={disabled}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {allowClear && isSelected && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-muted/60"
                    onClick={() => {
                      onChange?.(null);
                      setQuery("");
                      setOptions([]);
                      setOpen(false);
                    }}
                    aria-label="Clear"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {loading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading...</div>
              ) : options.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No matches</div>
              ) : (
                options.map((opt) => {
                  const code = opt.code;
                  const name = opt.name;
                  const selected = isSelected && value.code === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selected ? "bg-muted/60" : "bg-transparent"}`}
                      onClick={() => {
                        onChange?.({ code, name, id: opt.id });
                        setOpen(false);
                      }}
                    >
                      {name}
                    </button>
                  );
                })
              )}
            </div>

            <div className="p-2 border-t border-border text-[11px] text-muted-foreground">
              {master}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


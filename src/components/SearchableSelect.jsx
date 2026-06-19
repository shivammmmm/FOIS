import { useEffect, useRef, useState, useMemo } from "react";
import { ChevronDown, X, Search } from "lucide-react";

/**
 * SearchableSelect — a lightweight, purely client-side searchable dropdown.
 *
 * Props:
 *   options        — array of { value, label } objects
 *   value          — currently selected value string (matches option.value)
 *   onChange       — callback(value: string) — called with option.value on select
 *   placeholder    — placeholder text when nothing selected
 *   disabled       — disables the control
 *   allowClear     — show X to clear selection (default true)
 *   className      — extra class for the root wrapper
 *   inputClassName — extra class for the trigger button
 *   id             — optional id for the trigger button (for label association)
 */
export default function SearchableSelect({
  options = [],
  value = "",
  onChange,
  placeholder = "Select...",
  disabled = false,
  allowClear = true,
  className = "",
  inputClassName = "",
  id,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleOutsideClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    const found = options.find((o) => o.value === value);
    return found ? found.label : value;
  }, [value, options]);

  // Client-side filter: case-insensitive, matches label or value
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q)
    );
  }, [options, query]);

  const handleSelect = (optValue) => {
    onChange?.(optValue);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.("");
    setQuery("");
    setOpen(false);
  };

  const handleToggle = () => {
    if (disabled) return;
    setOpen((v) => {
      if (!v) setQuery(""); // clear search on open
      return !v;
    });
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        id={id}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-primary/60 focus:border-primary focus:ring-1 focus:ring-primary/30"}
          ${inputClassName}`}
      >
        <span className={`truncate flex-1 text-left ${selectedLabel ? "text-foreground" : "text-muted-foreground"}`}>
          {selectedLabel || placeholder}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {allowClear && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
              aria-label="Clear selection"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No matches for &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors
                      ${isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted/50 text-foreground"
                      }`}
                  >
                    {opt.label}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer count */}
          <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">
            {filtered.length} of {options.length} options
          </div>
        </div>
      )}
    </div>
  );
}

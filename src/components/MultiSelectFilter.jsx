import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";

function normalizeOption(option) {
  if (typeof option === "string") {
    return { value: option, label: option, searchText: option };
  }

  const value = String(option?.value ?? "");
  const label = String(option?.label ?? value);
  return {
    value,
    label,
    searchText: String(option?.searchText ?? `${label} ${value}`),
  };
}

export default function MultiSelectFilter({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder,
  className = "",
  buttonClassName = "",
  disabled = false,
  align = "left",
  maxHeightClassName = "max-h-60",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const normalizedOptions = useMemo(
    () =>
      options
        .map(normalizeOption)
        .filter((option) => option.value && option.value !== "All"),
    [options]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((option) =>
      option.searchText.toLowerCase().includes(q)
    );
  }, [normalizedOptions, query]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) =>
      Math.min(Math.max(index, 0), Math.max(filteredOptions.length - 1, 0))
    );
  }, [filteredOptions.length]);

  const toggleValue = (value) => {
    if (!value) return;
    const next = selectedSet.has(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    onChange?.(next);
  };

  const selectAll = () => {
    onChange?.(normalizedOptions.map((option) => option.value));
  };

  const clearAll = () => {
    onChange?.([]);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(index + 1, Math.max(filteredOptions.length - 1, 0))
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && filteredOptions[activeIndex]) {
      event.preventDefault();
      toggleValue(filteredOptions[activeIndex].value);
    }
  };

  const summary =
    selected.length === 0
      ? placeholder || `All ${label}s`
      : selected.length === 1
        ? normalizedOptions.find((option) => option.value === selected[0])
            ?.label || selected[0]
        : `${selected.length} ${label}s`;

  return (
    <div ref={rootRef} className={cn("relative min-w-[11rem]", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-left text-sm text-foreground outline-none transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60",
          buttonClassName
        )}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={cn(
            "fixed z-[1000] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          )}
          style={(() => { const rect = rootRef.current?.getBoundingClientRect(); const width = Math.max(rect?.width || 176, 288); const left = align === "right" ? Math.max(16, (rect?.right || width) - width) : Math.min(rect?.left || 16, window.innerWidth - width - 16); return { top: Math.min((rect?.bottom || 0) + 4, window.innerHeight - 360), left, width }; })()}
          onKeyDown={handleKeyDown}
        >
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] font-semibold text-primary">
            <button type="button" onClick={selectAll} className="hover:underline">
              Select All
            </button>
            <span className="text-muted-foreground">
              {selected.length} selected
            </span>
            <button type="button" onClick={clearAll} className="hover:underline">
              Clear All
            </button>
          </div>

          <div className={cn("overflow-y-auto py-1", maxHeightClassName)} role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                No {label.toLowerCase()} found
              </div>
            ) : (
              filteredOptions.map((option, index) => {
                const checked = selectedSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggleValue(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      index === activeIndex ? "bg-muted/70" : "hover:bg-muted/50",
                      checked ? "text-primary" : "text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background"
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            {filteredOptions.length} of {normalizedOptions.length} options
          </div>
        </div>, document.body
      )}
    </div>
  );
}

const PREFIX = "railflow.savedFilters";

export function filterStorageKey(source, userId) {
  return `${PREFIX}.${userId || "anonymous"}.${source}`;
}

export function readPersistentFilters(source, userId) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(filterStorageKey(source, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.filters || null;
  } catch {
    return null;
  }
}

export function writePersistentFilters(source, userId, filters) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    filterStorageKey(source, userId),
    JSON.stringify({
      filters,
      savedAt: new Date().toISOString(),
    })
  );
}

export function clearPersistentFilters(source, userId) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(filterStorageKey(source, userId));
}

export function normalizeMultiValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || value === "All") return [];
  return [value];
}

export function optionMatches(selectedValues, value) {
  return selectedValues.length === 0 || selectedValues.includes(value);
}

export function hasSavedFilterValues(filters = {}) {
  return Object.values(filters).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && value !== "All");
  });
}

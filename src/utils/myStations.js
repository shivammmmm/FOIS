export function normalizeStationCode(code) {
  const s = String(code ?? "").trim().toUpperCase();
  return s || null;
}

export function getMyStationCodes(watchlist = []) {
  const set = new Set();
  for (const s of watchlist || []) {
    const code = normalizeStationCode(s?.station_code);
    if (code) set.add(code);
  }
  return set;
}

export function isWatchedStationCode(code, watchCodesSet) {
  const c = normalizeStationCode(code);
  if (!c) return false;
  return !!watchCodesSet?.has(c);
}


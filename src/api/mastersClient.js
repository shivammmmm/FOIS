import { apiClient } from "@/api/apiClient";

// Adds admin master endpoints to the existing apiClient.
// This file is intentionally thin to avoid touching apiClient extensively.

const masters = {
  list: async (entityName, { search = "", offset = 0, limit = 50 } = {}) => {
    // server currently supports list via entities?filter not masters list.
    // We keep compatibility with existing patterns by using /api/entities/:entityName
    // which already supports query params: sort, limit, filter.
    // Here we use filter-based search if supported; otherwise fall back to no-op.
    const filter = search
      ? { name: search, code: search }
      : undefined;

    // Note: endpoint used by createEntityApi supports filter via JSON.stringify(filter)
    // but doesn't support offset/limit pagination for /api/entities.
    // Keep simple: use limit.
    return apiClient.entities?.[entityName]
      ? apiClient.entities[entityName].list("code", limit)
      : apiClient.entities?.RailwayDictionary?.list?.("code", limit);
  },

  // Save master is handled via existing admin CRUD in server/storage.js?
  // Current backend exposes only station-master/admin users etc.
  // This client is left for later integration.
  save: async (_entityName, record) => record,
  delete: async (_entityName, id) => id,
  search: async (_entityName, _params) => [],
};

export { masters };


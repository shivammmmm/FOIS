const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const ENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const entityListCache = new Map();

function getToken() {
  return window.localStorage.getItem("token") || window.localStorage.getItem("base44_access_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const { responseType = "json", headers, ...fetchOptions } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const details = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : { error: await response.text().catch(() => "") };
    const error = new Error(details.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  return response.json();
}

function createEntityApi(entityName) {
  const invalidate = () => {
    for (const key of entityListCache.keys()) {
      if (key.startsWith(`${entityName}|`)) entityListCache.delete(key);
    }
  };

  return {
    list: (sortOrder, limit) => {
      const params = new URLSearchParams();
      if (sortOrder) params.set("sort", sortOrder);
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      const cacheKey = `${entityName}|${getToken() || "anonymous"}|${query}`;
      const cached = entityListCache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt < ENTITY_CACHE_TTL_MS) {
        return cached.promise;
      }
      const promise = request(`/api/entities/${entityName}${query ? `?${query}` : ""}`)
        .catch((error) => {
          entityListCache.delete(cacheKey);
          throw error;
        });
      entityListCache.set(cacheKey, { createdAt: Date.now(), promise });
      return promise;
    },

    filter: (criteria, sortOrder, limit) => {
      const params = new URLSearchParams();
      if (criteria) params.set("filter", JSON.stringify(criteria));
      if (sortOrder) params.set("sort", sortOrder);
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      return request(`/api/entities/${entityName}${query ? `?${query}` : ""}`);
    },

    create: async (record) => {
      const result = await request(`/api/entities/${entityName}`, {
        method: "POST",
        body: JSON.stringify(record || {}),
      });
      invalidate();
      return result;
    },

    update: async (id, updatedFields) => {
      const result = await request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(updatedFields || {}),
      });
      invalidate();
      return result;
    },

    delete: async (id) => {
      const result = await request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      invalidate();
      return result;
    },

    bulkCreate: async (records) => {
      const result = await request(`/api/entities/${entityName}/bulk`, {
        method: "POST",
        body: JSON.stringify({ records: Array.isArray(records) ? records : [] }),
      });
      invalidate();
      return result;
    },
  };
}

export const apiClient = {
  readOnlyMasters: {
    states: () => request("/api/masters/states"),
    districts: (state = "") => request(`/api/masters/districts${state ? `?state=${encodeURIComponent(state)}` : ""}`),
  },
  notifications: {
    list: () => request("/api/notifications"),
    markRead: (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
    markAllRead: () => request("/api/notifications/mark-all-read", { method: "POST" }),
  },
  // --- Upgraded Phase 1: Explicit Sub-Objects Expected by Dropdowns & Admin views ---
  stateMaster: {
    list: (params) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/state-master${q ? `?${q}` : ""}`);
    },
    save: (payload) =>
      request("/api/state-master", {
        method: "POST",
        body: JSON.stringify(payload || {}),
      }),
    update: (id, payload) =>
      request(`/api/state-master/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload || {}),
      }),
    delete: (id) =>
      request(`/api/state-master/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  },

  districtMaster: {
    list: (params) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/district-master${q ? `?${q}` : ""}`);
    },
    save: (payload) =>
      request("/api/district-master", {
        method: "POST",
        body: JSON.stringify(payload || {}),
      }),
    update: (id, payload) =>
      request(`/api/district-master/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload || {}),
      }),
    delete: (id) =>
      request(`/api/district-master/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    deleteAll: () => request("/api/district-master", { method: "DELETE" }),
  },

  // --- Upgraded Phase 2: Operations Dashboard Filter Matrix ---
  dashboard: {
    filter: (payload) =>
      request("/api/dashboard/freight/filter", {
        method: "POST",
        body: JSON.stringify(payload || {}),
      }),
  },

  // Existing Masters Object Wrapper for Backward Compatibility
  masters: {
    list: (table, { search = "", offset = 0, limit = 50, state = "" } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (state) params.set("state", state);
      if (typeof offset === "number") params.set("offset", String(offset));
      if (typeof limit === "number") params.set("limit", String(limit));

      const route = table === "state_master" ? "/api/state-master" : "/api/district-master";
      const query = params.toString();
      return request(`${route}${query ? `?${query}` : ""}`);
    },
    get: (table, id) => {
      const route = table === "state_master" ? `/api/state-master/${encodeURIComponent(id)}` : `/api/district-master/${encodeURIComponent(id)}`;
      return request(route);
    },
    create: (table, payload) => {
      const route = table === "state_master" ? "/api/state-master" : "/api/district-master";
      return request(route, { method: "POST", body: JSON.stringify(payload || {}) });
    },
    update: (table, id, payload) => {
      const route = table === "state_master" ? `/api/state-master/${encodeURIComponent(id)}` : `/api/district-master/${encodeURIComponent(id)}`;
      return request(route, { method: "PUT", body: JSON.stringify(payload || {}) });
    },
    delete: (table, id) => {
      const route = table === "state_master" ? `/api/state-master/${encodeURIComponent(id)}` : `/api/district-master/${encodeURIComponent(id)}`;
      return request(route, { method: "DELETE" });
    },

    listStates: (opts) => apiClient.masters.list("state_master", opts),
    getState: (id) => apiClient.masters.get("state_master", id),
    createState: (payload) => apiClient.masters.create("state_master", payload),
    updateState: (id, payload) => apiClient.masters.update("state_master", id, payload),
    deleteState: (id) => apiClient.masters.delete("state_master", id),

    listDistricts: (opts) => apiClient.masters.list("district_master", opts),
    getDistrict: (id) => apiClient.masters.get("district_master", id),
    createDistrict: (payload) => apiClient.masters.create("district_master", payload),
    updateDistrict: (id, payload) => apiClient.masters.update("district_master", id, payload),
    deleteDistrict: (id) => apiClient.masters.delete("district_master", id),
  },

  masterCatalog: {
    list: (master, { search = "", offset = 0, limit = 25 } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeof offset === "number") params.set("offset", String(offset));
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      return request(`/api/masters/catalog/${encodeURIComponent(master)}${query ? `?${query}` : ""}`);
    },
    create: (master, payload) =>
      request(`/api/masters/catalog/${encodeURIComponent(master)}`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      }),
    bulkImportDistricts: async (records) => {
      try {
        return await request("/api/masters/catalog/district/bulk", {
          method: "POST",
          body: JSON.stringify({ records }),
        });
      } catch (error) {
        if (error?.status !== 404 || !/Cannot POST|Request failed/i.test(error?.message || "")) {
          throw error;
        }

        let imported = 0;
        let failed = 0;
        const batchSize = 8;
        for (let index = 0; index < records.length; index += batchSize) {
          const batch = records.slice(index, index + batchSize);
          const results = await Promise.allSettled(
            batch.map((record) => apiClient.districtMaster.save(record))
          );
          imported += results.filter((result) => result.status === "fulfilled").length;
          failed += results.filter((result) => result.status === "rejected").length;
        }
        return { imported, failed, fallback: true };
      }
    },
    update: (master, id, payload) =>
      request(`/api/masters/catalog/${encodeURIComponent(master)}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload || {}),
      }),
    delete: (master, id) =>
      request(`/api/masters/catalog/${encodeURIComponent(master)}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  },

  stationMaster: {
    list: ({ search, offset, limit } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeof offset === "number") params.set("offset", String(offset));
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      return request(`/api/station-master${query ? `?${query}` : ""}`);
    },
    save: (station) =>
      request("/api/admin/station-master", {
        method: "POST",
        body: JSON.stringify(station || {}),
      }),
    delete: (id) =>
      request(`/api/admin/station-master/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    upload: ({ fileName, fileBase64 }) =>
      request("/api/station-master/upload", {
        method: "POST",
        body: JSON.stringify({ fileName, fileBase64 }),
      }),
    export: () =>
      request("/api/station-master/export", {
        method: "GET",
        responseType: "blob",
      }),
  },

  admin: {
    users: {
      list: () => request("/api/admin/users"),
      updateRole: (id, role) =>
        request(`/api/admin/users/${encodeURIComponent(id)}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        }),
    },
    uploads: {
      excel: async ({ fileName, fileType, file }) => {
        const token = getToken();
        const chunkSize = 700 * 1024;
        const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
        const uploadId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        let details = {};
        for (let index = 0; index < totalChunks; index += 1) {
          const params = new URLSearchParams({ fileName, fileType, uploadId, index: String(index), total: String(totalChunks) });
          const response = await fetch(`${API_BASE_URL}/api/admin/uploads/excel/chunk?${params}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: await file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize)).arrayBuffer(),
          });
          details = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(details.error || `Upload failed at part ${index + 1}: ${response.status}`);
        }
        return details;
      },
    },
    uploadHistory: {
      list: ({ limit = 100 } = {}) => {
        const params = new URLSearchParams();
        if (typeof limit === "number") params.set("limit", String(limit));
        const query = params.toString();
        return request(`/api/admin/upload-history${query ? `?${query}` : ""}`);
      },
      delete: (id) =>
        request(`/api/admin/upload-history/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    storageCounts: () => request("/api/admin/storage/counts"),
  },

  entities: {
    FreightMovement: createEntityApi("FreightMovement"),
    MaturedIndent: createEntityApi("MaturedIndent"),
    UploadLog: createEntityApi("UploadLog"),
    RailNotification: createEntityApi("RailNotification"),
    UserSettings: createEntityApi("UserSettings"),
    RailwayDictionary: createEntityApi("RailwayDictionary"),
    UserNotificationPreference: createEntityApi("UserNotificationPreference"),
    UserWatchlist: createEntityApi("UserWatchlist"),
    SavedFilter: createEntityApi("SavedFilter"),
  },
};

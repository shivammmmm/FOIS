const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

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
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  return response.json();
}

function createEntityApi(entityName) {
  return {
    list: (sortOrder, limit) => {
      const params = new URLSearchParams();
      if (sortOrder) params.set("sort", sortOrder);
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      return request(`/api/entities/${entityName}${query ? `?${query}` : ""}`);
    },

    filter: (criteria, sortOrder, limit) => {
      const params = new URLSearchParams();
      if (criteria) params.set("filter", JSON.stringify(criteria));
      if (sortOrder) params.set("sort", sortOrder);
      if (typeof limit === "number") params.set("limit", String(limit));

      const query = params.toString();
      return request(`/api/entities/${entityName}${query ? `?${query}` : ""}`);
    },

    create: (record) =>
      request(`/api/entities/${entityName}`, {
        method: "POST",
        body: JSON.stringify(record || {}),
      }),

    update: (id, updatedFields) =>
      request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(updatedFields || {}),
      }),

    delete: (id) =>
      request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),

    bulkCreate: (records) =>
      request(`/api/entities/${entityName}/bulk`, {
        method: "POST",
        body: JSON.stringify({ records: Array.isArray(records) ? records : [] }),
      }),
  };
}

export const apiClient = {
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
      excel: ({ fileName, fileType, fileBase64 }) =>
        request("/api/admin/uploads/excel", {
          method: "POST",
          body: JSON.stringify({ fileName, fileType, fileBase64 }),
        }),
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

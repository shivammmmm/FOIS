// Local mock client to replace @base44/sdk persistence for a full client-side run.
// It mimics the minimal method shapes used by the application.

const STORAGE_KEYS = {
  // entity buckets
  FreightMovement: "localClient_FreightMovement",
  MaturedIndent: "localClient_MaturedIndent",
  UploadLog: "localClient_UploadLog",
  RailNotification: "localClient_RailNotification",
  UserSettings: "localClient_UserSettings",
  RailwayDictionary: "localClient_RailwayDictionary",
  UserNotificationPreference: "localClient_UserNotificationPreference",
  UserWatchlist: "localClient_UserWatchlist",
  SavedFilter: "localClient_SavedFilter",
};

const safeJsonParse = (value, fallback) => {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

const normalizeSortDir = (sortOrder) => {
  // Expected patterns: 'date', '-date', '-upload_time', etc.
  if (!sortOrder || typeof sortOrder !== "string")
    return { key: null, desc: false };
  const desc = sortOrder.startsWith("-");
  const key = desc ? sortOrder.slice(1) : sortOrder;
  return { key: key || null, desc };
};

const getStorage = (key) => {
  return safeJsonParse(window.localStorage.getItem(key), []);
};

const setStorage = (key, value) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

const generateId = () => {
  // Unique enough for UI mocks; also avoids collisions across rapid calls.
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const ensureEntityDefaults = (record, { createdKey, extraCreatedKey } = {}) => {
  const r = { ...(record || {}) };
  if (createdKey && !r[createdKey]) r[createdKey] = nowIso();
  if (extraCreatedKey && !r[extraCreatedKey]) r[extraCreatedKey] = nowIso();
  return r;
};

const sortRecords = (records, sortOrder) => {
  const { key, desc } = normalizeSortDir(sortOrder);
  if (!key) return records;

  const copy = [...records];
  copy.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];

    // Handle undefined/null gracefully
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    // If values look like ISO dates, compare as dates; else lexicographic.
    const aDate = typeof av === "string" ? Date.parse(av) : NaN;
    const bDate = typeof bv === "string" ? Date.parse(bv) : NaN;

    let result = 0;
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
      result = aDate - bDate;
    } else {
      result = String(av).localeCompare(String(bv));
    }

    return desc ? -result : result;
  });
  return copy;
};

const matchesCriteria = (record, criteria) => {
  // Supports basic equality matching by key/value.
  if (!criteria || typeof criteria !== "object") return true;
  return Object.entries(criteria).every(([k, v]) => {
    // If criteria value is an array => match if record[k] is included.
    if (Array.isArray(v)) return v.includes(record?.[k]);
    return record?.[k] === v;
  });
};

const createEntityApi = ({
  storageKey,
  createdDateKey,
  uploadTimeKey,
} = {}) => {
  return {
    list: (sortOrder, limit) => {
      const records = getStorage(storageKey);
      const sorted = sortRecords(records, sortOrder);
      const lim = typeof limit === "number" ? limit : undefined;
      const sliced = typeof lim === "number" ? sorted.slice(0, lim) : sorted;
      return Promise.resolve(sliced);
    },

    // filter is used by multiple entities (FreightMovement, RailNotification, UserSettings)
    filter: (criteria) => {
      const records = getStorage(storageKey);
      const filtered = records.filter((r) => matchesCriteria(r, criteria));
      return Promise.resolve(filtered);
    },

    create: (record) => {
      const r = ensureEntityDefaults(record, {
        createdKey: createdDateKey,
        extraCreatedKey: uploadTimeKey,
      });
      if (r.id == null) r.id = generateId();

      const records = getStorage(storageKey);
      records.push(r);
      setStorage(storageKey, records);
      return Promise.resolve(r);
    },

    update: (id, updatedFields) => {
      const records = getStorage(storageKey);
      const idx = records.findIndex(
        (r) => r.id === id || String(r.id) === String(id)
      );
      if (idx === -1) {
        // create-ish fallback if update called for missing item
        const r = ensureEntityDefaults(
          { ...(updatedFields || {}) },
          {
            createdKey: createdDateKey,
            extraCreatedKey: uploadTimeKey,
          }
        );
        r.id = id;
        records.push(r);
        setStorage(storageKey, records);
        return Promise.resolve(r);
      }
      const next = { ...records[idx], ...(updatedFields || {}) };
      if (createdDateKey && !next[createdDateKey])
        next[createdDateKey] = nowIso();
      if (uploadTimeKey && !next[uploadTimeKey]) next[uploadTimeKey] = nowIso();
      records[idx] = next;
      setStorage(storageKey, records);
      return Promise.resolve(next);
    },

    delete: (id) => {
      const records = getStorage(storageKey);
      const next = records.filter(
        (r) => !(r.id === id || String(r.id) === String(id))
      );
      setStorage(storageKey, next);
      return Promise.resolve({
        deletedId: id,
        count: records.length - next.length,
      });
    },

    bulkCreate: (records) => {
      const arr = Array.isArray(records) ? records : [];
      const existing = getStorage(storageKey);
      const created = arr.map((rec) => {
        const r = ensureEntityDefaults(rec, {
          createdKey: createdDateKey,
          extraCreatedKey: uploadTimeKey,
        });
        if (r.id == null) r.id = generateId();
        return r;
      });
      const next = [...existing, ...created];
      setStorage(storageKey, next);
      return Promise.resolve(created);
    },
  };
};

// Instantiate entity APIs with keys matching app expectations.
export const localClient = {
  entities: {
    FreightMovement: createEntityApi({
      storageKey: STORAGE_KEYS.FreightMovement,
      createdDateKey: "created_date",
    }),

    MaturedIndent: createEntityApi({
      storageKey: STORAGE_KEYS.MaturedIndent,
      createdDateKey: "created_date",
    }),

    UploadLog: createEntityApi({
      storageKey: STORAGE_KEYS.UploadLog,
      createdDateKey: "created_date",
      uploadTimeKey: "upload_time",
    }),

    RailNotification: createEntityApi({
      storageKey: STORAGE_KEYS.RailNotification,
      createdDateKey: "created_date",
    }),

    UserSettings: createEntityApi({
      storageKey: STORAGE_KEYS.UserSettings,
      createdDateKey: "created_date",
    }),

    RailwayDictionary: createEntityApi({
      storageKey: STORAGE_KEYS.RailwayDictionary,
      createdDateKey: "created_date",
    }),

    UserNotificationPreference: createEntityApi({
      storageKey: STORAGE_KEYS.UserNotificationPreference,
      createdDateKey: "created_date",
    }),

    UserWatchlist: createEntityApi({
      storageKey: STORAGE_KEYS.UserWatchlist,
      createdDateKey: "created_at",
    }),

    SavedFilter: createEntityApi({
      storageKey: STORAGE_KEYS.SavedFilter,
      createdDateKey: "created_at",
    }),
  },
};

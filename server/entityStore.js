import { assertEntity, readDb, writeDb } from "./db.js";

const CREATED_DATE_KEYS = {
  FreightMovement: "created_date",
  MaturedIndent: "created_date",
  UploadLog: "created_date",
  RailNotification: "created_date",
  UserSettings: "created_date",
  RailwayDictionary: "created_date",
  UserNotificationPreference: "created_date",
  UserWatchlist: "created_at",
  SavedFilter: "created_at",
};

const EXTRA_CREATED_DATE_KEYS = {
  UploadLog: "upload_time",
};

const nowIso = () => new Date().toISOString();

const generateId = () =>
  `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;

function normalizeSort(sortOrder) {
  if (!sortOrder || typeof sortOrder !== "string") {
    return { key: null, desc: false };
  }

  const desc = sortOrder.startsWith("-");
  const key = desc ? sortOrder.slice(1) : sortOrder;
  return { key: key || null, desc };
}

function sortRecords(records, sortOrder) {
  const { key, desc } = normalizeSort(sortOrder);
  if (!key) return records;

  return [...records].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];

    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    const aDate = typeof av === "string" ? Date.parse(av) : NaN;
    const bDate = typeof bv === "string" ? Date.parse(bv) : NaN;
    const result =
      !Number.isNaN(aDate) && !Number.isNaN(bDate)
        ? aDate - bDate
        : String(av).localeCompare(String(bv));

    return desc ? -result : result;
  });
}

function matchesCriteria(record, criteria) {
  if (!criteria || typeof criteria !== "object") return true;

  return Object.entries(criteria).every(([key, value]) => {
    if (value === undefined || value === null || value === "") return true;
    if (Array.isArray(value)) return value.includes(record?.[key]);
    return record?.[key] === value;
  });
}

function withDefaults(entityName, record) {
  const next = { ...(record || {}) };
  const createdKey = CREATED_DATE_KEYS[entityName];
  const extraCreatedKey = EXTRA_CREATED_DATE_KEYS[entityName];

  if (next.id == null) next.id = generateId();
  if (createdKey && !next[createdKey]) next[createdKey] = nowIso();
  if (extraCreatedKey && !next[extraCreatedKey]) next[extraCreatedKey] = nowIso();

  return next;
}

export async function listRecords(entityName, { sort, limit, filter } = {}) {
  assertEntity(entityName);

  const db = await readDb();
  const records = db[entityName].filter((record) => matchesCriteria(record, filter));
  const sorted = sortRecords(records, sort);
  const parsedLimit = Number.parseInt(limit, 10);

  return Number.isFinite(parsedLimit) ? sorted.slice(0, parsedLimit) : sorted;
}

export async function createRecord(entityName, record) {
  assertEntity(entityName);

  const db = await readDb();
  const created = withDefaults(entityName, record);
  db[entityName].push(created);
  await writeDb(db);

  return created;
}

export async function createRecords(entityName, records) {
  assertEntity(entityName);

  const db = await readDb();
  const created = (Array.isArray(records) ? records : []).map((record) =>
    withDefaults(entityName, record)
  );
  db[entityName].push(...created);
  await writeDb(db);

  return created;
}

export async function updateRecord(entityName, id, fields) {
  assertEntity(entityName);

  const db = await readDb();
  const index = db[entityName].findIndex(
    (record) => record.id === id || String(record.id) === String(id)
  );

  if (index === -1) {
    const created = withDefaults(entityName, { ...(fields || {}), id });
    db[entityName].push(created);
    await writeDb(db);
    return created;
  }

  const updated = {
    ...db[entityName][index],
    ...(fields || {}),
    id: db[entityName][index].id,
  };
  db[entityName][index] = updated;
  await writeDb(db);

  return updated;
}

export async function deleteRecord(entityName, id) {
  assertEntity(entityName);

  const db = await readDb();
  const before = db[entityName].length;
  db[entityName] = db[entityName].filter(
    (record) => !(record.id === id || String(record.id) === String(id))
  );
  await writeDb(db);

  return { deletedId: id, count: before - db[entityName].length };
}

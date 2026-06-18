import bcrypt from "bcryptjs";
import { Pool } from "pg";
import {
  createRecord as jsonCreateRecord,
  createRecords as jsonCreateRecords,
  deleteRecord as jsonDeleteRecord,
  listRecords as jsonListRecords,
  updateRecord as jsonUpdateRecord,
} from "./entityStore.js";
import { readDb, writeDb } from "./db.js";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

const ENTITY_TABLES = {
  FreightMovement: "freight_movements",
  MaturedIndent: "matured_indents",
  UploadLog: "upload_logs",
  RailNotification: "rail_notifications",
  UserSettings: "user_settings",
  UserNotificationPreference: "user_notification_preferences",
  UserWatchlist: "user_watchlist",
  SavedFilter: "saved_filters",

  // Phase 5 - notification dedup history
  notification_history: "notification_history",

  // Admin master tables (Phase 2)
  RailwayDictionary: "railway_dictionary",
  station_master: "station_master",
  zone_master: "zone_master",
  division_master: "division_master",
  state_master: "state_master",
  district_master: "district_master",
  unmapped_station_codes: "unmapped_station_codes",

  // Phase-3B commodity masters
  CommodityGroupMaster: "commodity_group_master",
  CommodityMaster: "commodity_master",
  RakeCommodityMaster: "rake_commodity_master",
};

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

  // Phase 2 masters
  station_master: "created_date",
  zone_master: "created_date",
  division_master: "created_date",
  state_master: "created_date",
  district_master: "created_date",
  unmapped_station_codes: "created_date",

  CommodityGroupMaster: "created_at",
  CommodityMaster: "created_at",
  RakeCommodityMaster: "created_at",
};

const EXTRA_CREATED_DATE_KEYS = {
  UploadLog: "upload_time",
};

const STATION_ENRICHMENT_COLUMN_NAMES = [
  "station_from",
  "station_to",
  "from_station_name",
  "from_district",
  "from_state",
  "from_division",
  "from_zone",
  "to_station_name",
  "to_district",
  "to_state",
  "to_division",
  "to_zone",
];

const COMMODITY_ENRICHMENT_COLUMN_NAMES = [
  "commodity_code",
  "commodity_name",
  "commodity_group",

  "rake_commodity_code",
  "rake_commodity_name",
  "rake_commodity_group",
];

const STATION_ENRICHED_ENTITIES = new Set(["FreightMovement", "MaturedIndent"]);
const USER_PROFILE_ENTITIES = new Set([
  "UserNotificationPreference",
  "UserWatchlist",
  "SavedFilter",
]);

const pool = new Pool({ connectionString: DATABASE_URL });
let activeStorage = "json";

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

function assertEntity(entityName) {
  if (!ENTITY_TABLES[entityName]) {
    const error = new Error(`Unknown entity: ${entityName}`);
    error.status = 404;
    throw error;
  }
}

function withDefaults(entityName, record) {
  const next = { ...(record || {}) };
  const createdKey = CREATED_DATE_KEYS[entityName];
  const extraCreatedKey = EXTRA_CREATED_DATE_KEYS[entityName];

  if (next.id == null) next.id = generateId();
  if (createdKey && !next[createdKey]) next[createdKey] = nowIso();
  if (extraCreatedKey && !next[extraCreatedKey])
    next[extraCreatedKey] = nowIso();

  return next;
}

function fromRow(row) {
  if (row && row.event_key !== undefined && row.notification_type !== undefined) {
    return {
      id: row.id,
      event_key: row.event_key,
      notification_type: row.notification_type,
      station_code: row.station_code,
      movement_reference: row.movement_reference,
      created_at: row.created_at?.toISOString?.() || row.created_at,
    };
  }

  return {
    ...Object.fromEntries(
      STATION_ENRICHMENT_COLUMN_NAMES.filter(
        (columnName) => row[columnName] !== undefined
      ).map((columnName) => [columnName, row[columnName]])
    ),
    ...(row.data || {}),
    id: row.id,
    created_date: row.created_date?.toISOString?.() || row.created_date,
    updated_date: row.updated_date?.toISOString?.() || row.updated_date,
  };
}

function stationColumnValues(record) {
  return STATION_ENRICHMENT_COLUMN_NAMES.map((columnName) =>
    record?.[columnName] == null || record?.[columnName] === ""
      ? null
      : String(record[columnName])
  );
}

function commodityColumnValues(record) {
  return COMMODITY_ENRICHMENT_COLUMN_NAMES.map((columnName) =>
    record?.[columnName] == null || record?.[columnName] === ""
      ? null
      : String(record[columnName])
  );
}

async function ensureStationEnrichmentColumns(tableName) {
  for (const columnName of STATION_ENRICHMENT_COLUMN_NAMES) {
    await pool.query(
      `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} TEXT`
    );
  }
}

async function createEntityTable(tableName) {
  // Phase-2 masters use columnar schema for fast search + indexing.
  if (tableName === "station_master") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS station_master (
        id TEXT PRIMARY KEY,
        station_code TEXT UNIQUE NOT NULL,
        station_name TEXT,
        district TEXT,
        state TEXT,
        division TEXT,
        zone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "ALTER TABLE station_master ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"
    );
    return;
  }

  if (tableName === "unmapped_station_codes") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS unmapped_station_codes (
        id TEXT PRIMARY KEY,
        station_code TEXT UNIQUE NOT NULL,
        station_name TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        occurrence_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unmapped',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "ALTER TABLE unmapped_station_codes ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    );
    await pool.query(
      "ALTER TABLE unmapped_station_codes ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    );
    await pool.query(
      "ALTER TABLE unmapped_station_codes ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 0"
    );
    await pool.query(
      "ALTER TABLE unmapped_station_codes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unmapped'"
    );
    return;
  }

  if (tableName === "commodity_group_master") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commodity_group_master (
        id TEXT PRIMARY KEY,
        group_code TEXT UNIQUE NOT NULL,
        group_name TEXT,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return;
  }

  if (tableName === "commodity_master") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commodity_master (
        id TEXT PRIMARY KEY,
        commodity_code TEXT UNIQUE NOT NULL,
        commodity_name TEXT,
        commodity_group_code TEXT,
        commodity_group_name TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS commodity_master_commodity_group_code_idx ON commodity_master (commodity_group_code)"
    );
    return;
  }

  if (tableName === "rake_commodity_master") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rake_commodity_master (
        id TEXT PRIMARY KEY,
        rake_commodity_code TEXT UNIQUE NOT NULL,
        rake_commodity_name TEXT,
        commodity_group_code TEXT,
        commodity_group_name TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS rake_commodity_master_commodity_group_code_idx ON rake_commodity_master (commodity_group_code)"
    );
    return;
  }

  if (tableName.endsWith("_master")) {
    // zone_master / division_master / state_master / district_master
    // Generic format: code + name + (district/state/zone refs as text for now)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT,
        parent_code TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return;
  }

  if (["freight_movements", "matured_indents"].includes(tableName)) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await ensureStationEnrichmentColumns(tableName);

    // Commodity columns for filtering/enrichment
    for (const columnName of COMMODITY_ENRICHMENT_COLUMN_NAMES) {
      await pool.query(
        `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} TEXT`
      );
    }

    // Indexes
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${tableName}_commodity_code_idx ON ${tableName} (commodity_code)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${tableName}_commodity_group_idx ON ${tableName} (commodity_group)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${tableName}_rake_commodity_code_idx ON ${tableName} (rake_commodity_code)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${tableName}_rake_commodity_group_idx ON ${tableName} (rake_commodity_group)`
    );

    // Date indexes (business-date fields)
    for (const dateCol of [
      "arrival_date",
      "departure_date",
      "indent_date",
      "maturity_date",
    ]) {
      await pool.query(
        `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${dateCol} TEXT`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${tableName}_${dateCol}_idx ON ${tableName} (${dateCol})`
      );
    }

    return;
  }

  if (tableName === "user_notification_preferences") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        inward_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        outward_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        delayed_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        missing_match_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        duplicate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        new_movement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS inward_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS outward_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS delayed_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS missing_match_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS duplicate_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "ALTER TABLE user_notification_preferences ADD COLUMN IF NOT EXISTS new_movement_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS user_notification_preferences_user_id_idx ON user_notification_preferences (user_id)"
    );
    return;
  }

  if (tableName === "user_watchlist") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_watchlist (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        station_code TEXT NOT NULL,
        station_name TEXT,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS user_watchlist_user_id_idx ON user_watchlist (user_id)"
    );
    return;
  }

  if (tableName === "notification_history") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_history (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL,
        notification_type TEXT NOT NULL,
        station_code TEXT,
        movement_reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS notification_history_event_key_uq ON notification_history (event_key)"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS notification_history_station_code_idx ON notification_history (station_code)"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS notification_history_notification_type_idx ON notification_history (notification_type)"
    );
    return;
  }

  if (tableName === "saved_filters") {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_filters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS saved_filters_user_id_idx ON saved_filters (user_id)"
    );
    return;
  }

  // Default legacy entities keep JSONB storage.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function initializeStorage() {
  try {
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'user')),
        password_hash TEXT NOT NULL,
        created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const tableName of Object.values(ENTITY_TABLES)) {
      await createEntityTable(tableName);
    }

    // Automatically backfill empty date columns from JSONB data on startup
    await pool.query(`
      UPDATE freight_movements 
      SET arrival_date = COALESCE(data->>'arrival_date', ''), 
          departure_date = COALESCE(data->>'departure_date', '') 
      WHERE arrival_date IS NULL OR arrival_date = '' OR departure_date IS NULL OR departure_date = ''
    `).catch(err => console.error("Freight movements date backfill failed on startup:", err));

    await pool.query(`
      UPDATE matured_indents 
      SET indent_date = COALESCE(data->>'indent_date', ''), 
          maturity_date = COALESCE(data->>'maturity_date', '') 
      WHERE indent_date IS NULL OR indent_date = '' OR maturity_date IS NULL OR maturity_date = ''
    `).catch(err => console.error("Matured indents date backfill failed on startup:", err));

    activeStorage = "postgres";
    console.log("PostgreSQL Connected");
  } catch (error) {
    activeStorage = "json";
    console.warn(
      `PostgreSQL unavailable; JSON storage active: ${error.message}`
    );
  }
}

export function getStorageStatus() {
  return {
    active: activeStorage,
    postgres: activeStorage === "postgres",
    json: activeStorage !== "postgres",
  };
}

export async function ensureSuperAdminExists(superAdmin) {
  const existing = await findUserByIdentifier(superAdmin.username);
  if (existing) return;

  const passwordHash = await bcrypt.hash(superAdmin.password, 10);
  await createUser({
    username: superAdmin.username,
    email: superAdmin.email,
    full_name: "Super Admin",
    role: "super_admin",
    password_hash: passwordHash,
  });
}

export async function findUserByIdentifier(identifier) {
  if (activeStorage === "postgres") {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1 OR email = $1 LIMIT 1",
      [String(identifier)]
    );
    return result.rows[0] || null;
  }

  const db = await readDb();
  const users = Array.isArray(db.Users) ? db.Users : [];
  return (
    users.find(
      (user) =>
        String(user.username) === String(identifier) ||
        String(user.email) === String(identifier)
    ) || null
  );
}

export async function findUserById(id) {
  if (activeStorage === "postgres") {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1 LIMIT 1",
      [String(id)]
    );
    return result.rows[0] || null;
  }

  const db = await readDb();
  const users = Array.isArray(db.Users) ? db.Users : [];
  return users.find((user) => String(user.id) === String(id)) || null;
}

export async function createUser(user) {
  const next = {
    id: user.id || `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    username: String(user.username),
    email: String(user.email),
    full_name: user.full_name || String(user.username),
    role: user.role || "user",
    password_hash: user.password_hash,
    created_date: user.created_date || nowIso(),
  };

  if (activeStorage === "postgres") {
    const result = await pool.query(
      `INSERT INTO users (id, username, email, full_name, role, password_hash, created_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        next.id,
        next.username,
        next.email,
        next.full_name,
        next.role,
        next.password_hash,
        next.created_date,
      ]
    );
    return result.rows[0];
  }

  const db = await readDb();
  const users = Array.isArray(db.Users) ? db.Users : [];
  db.Users = [...users, next];
  await writeDb(db);
  return next;
}

export async function listUsers() {
  if (activeStorage === "postgres") {
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, created_date, updated_date
       FROM users
       ORDER BY created_date DESC`
    );
    return result.rows;
  }

  const db = await readDb();
  const users = Array.isArray(db.Users) ? db.Users : [];
  return users.map(({ password_hash, ...user }) => user);
}

export async function updateUserRole(id, role) {
  if (!["super_admin", "admin", "user"].includes(role)) {
    const error = new Error("Invalid role");
    error.status = 400;
    throw error;
  }

  if (activeStorage === "postgres") {
    const result = await pool.query(
      `UPDATE users SET role = $2, updated_date = NOW()
       WHERE id = $1
       RETURNING id, username, email, full_name, role, created_date, updated_date`,
      [String(id), role]
    );
    if (!result.rows[0]) {
      const error = new Error("User not found");
      error.status = 404;
      throw error;
    }
    return result.rows[0];
  }

  const db = await readDb();
  const users = Array.isArray(db.Users) ? db.Users : [];
  const index = users.findIndex((user) => String(user.id) === String(id));
  if (index === -1) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }
  db.Users[index] = { ...users[index], role };
  await writeDb(db);
  const { password_hash, ...safeUser } = db.Users[index];
  return safeUser;
}

export async function listRecords(entityName, options = {}) {
  assertEntity(entityName);
  if (activeStorage !== "postgres") return jsonListRecords(entityName, options);

  const tableName = ENTITY_TABLES[entityName];
  const result = await pool.query(`SELECT * FROM ${tableName}`);
  const records = result.rows
    .map(fromRow)
    .filter((record) => matchesCriteria(record, options.filter));
  const sorted = sortRecords(records, options.sort);
  const parsedLimit = Number.parseInt(options.limit, 10);
  return Number.isFinite(parsedLimit) ? sorted.slice(0, parsedLimit) : sorted;
}

export async function createRecord(entityName, record) {
  assertEntity(entityName);
  if (activeStorage !== "postgres") return jsonCreateRecord(entityName, record);

  const tableName = ENTITY_TABLES[entityName];
  const created = withDefaults(entityName, record);
  if (STATION_ENRICHED_ENTITIES.has(entityName)) {
    const isIndent = entityName === "MaturedIndent";
    const dateColumns = isIndent
      ? ["indent_date", "maturity_date"]
      : ["arrival_date", "departure_date"];

    const allColumns = [
      ...STATION_ENRICHMENT_COLUMN_NAMES,
      ...COMMODITY_ENRICHMENT_COLUMN_NAMES,
      ...dateColumns,
    ];

    const allColumnsSql = allColumns.join(", ");

    const placeholders = allColumns
      .map((_, index) => `$${index + 4}`)
      .join(", ");

    const updatesSql = allColumns
      .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
      .join(", ");

    const dateValues = dateColumns.map((colName) =>
      created?.[colName] == null || created?.[colName] === ""
        ? null
        : String(created[colName])
    );

    await pool.query(
      `INSERT INTO ${tableName} (id, data, created_date, ${allColumnsSql})
       VALUES ($1, $2, $3, ${placeholders})
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ${updatesSql}, updated_date = NOW()`,
      [
        String(created.id),
        created,
        created.created_date || nowIso(),
        ...stationColumnValues(created),
        ...commodityColumnValues(created),
        ...dateValues,
      ]
    );
    return created;
  }

  if (USER_PROFILE_ENTITIES.has(entityName)) {
    const createdAt = created.created_at || created.created_date || nowIso();
    const createdColumn =
      entityName === "UserNotificationPreference"
        ? "created_date"
        : "created_at";
    const extraColumns =
      entityName === "UserNotificationPreference"
        ? [
            "user_id",
            "inward_enabled",
            "outward_enabled",
            "delayed_enabled",
            "missing_match_enabled",
            "duplicate_enabled",
            "new_movement_enabled",
          ]
        : entityName === "UserWatchlist"
        ? ["user_id", "station_code", "station_name"]
        : ["user_id", "name"];
    const columnsSql = extraColumns.join(", ");
    const placeholders = extraColumns
      .map((_, index) => `$${index + 4}`)
      .join(", ");
    const updatesSql = extraColumns
      .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
      .join(", ");

    await pool.query(
      `INSERT INTO ${tableName} (id, data, ${createdColumn}, ${columnsSql})
       VALUES ($1, $2, $3, ${placeholders})
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ${updatesSql}, updated_date = NOW()`,
      [
        String(created.id),
        created,
        createdAt,
        ...extraColumns.map((columnName) =>
          typeof created?.[columnName] === "boolean"
            ? created[columnName]
            : created?.[columnName] == null
            ? null
            : String(created[columnName])
        ),
      ]
    );
    return { ...created, created_at: createdAt };
  }

  if (entityName === "notification_history") {
    const createdAt = created.created_at || nowIso();
    await pool.query(
      `INSERT INTO notification_history (
         id,
         event_key,
         notification_type,
         station_code,
         movement_reference,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_key) DO UPDATE SET
         notification_type = EXCLUDED.notification_type,
         station_code = EXCLUDED.station_code,
         movement_reference = EXCLUDED.movement_reference`,
      [
        String(created.id),
        String(created.event_key || ""),
        String(created.notification_type || ""),
        created.station_code == null ? null : String(created.station_code),
        created.movement_reference == null
          ? null
          : String(created.movement_reference),
        createdAt,
      ]
    );
    return { ...created, created_at: createdAt };
  }

  await pool.query(
    `INSERT INTO ${tableName} (id, data, created_date)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_date = NOW()`,
    [String(created.id), created, created.created_date || nowIso()]
  );
  return created;
}

export async function createRecords(entityName, records) {
  assertEntity(entityName);
  const created = [];
  for (const record of Array.isArray(records) ? records : []) {
    created.push(await createRecord(entityName, record));
  }
  return created;
}

export async function updateRecord(entityName, id, fields) {
  assertEntity(entityName);
  if (activeStorage !== "postgres")
    return jsonUpdateRecord(entityName, id, fields);

  const tableName = ENTITY_TABLES[entityName];
  const existing = await pool.query(
    `SELECT * FROM ${tableName} WHERE id = $1`,
    [String(id)]
  );
  const updated = existing.rows[0]
    ? { ...fromRow(existing.rows[0]), ...(fields || {}), id: String(id) }
    : withDefaults(entityName, { ...(fields || {}), id: String(id) });

  if (STATION_ENRICHED_ENTITIES.has(entityName)) {
    const isIndent = entityName === "MaturedIndent";
    const dateColumns = isIndent
      ? ["indent_date", "maturity_date"]
      : ["arrival_date", "departure_date"];

    const allColumns = [
      ...STATION_ENRICHMENT_COLUMN_NAMES,
      ...COMMODITY_ENRICHMENT_COLUMN_NAMES,
      ...dateColumns,
    ];

    const allColumnsSql = allColumns.join(", ");

    const placeholders = allColumns
      .map((_, index) => `$${index + 4}`)
      .join(", ");

    const updatesSql = allColumns
      .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
      .join(", ");

    const dateValues = dateColumns.map((colName) =>
      updated?.[colName] == null || updated?.[colName] === ""
        ? null
        : String(updated[colName])
    );

    await pool.query(
      `INSERT INTO ${tableName} (id, data, created_date, updated_date, ${allColumnsSql})
       VALUES ($1, $2, $3, NOW(), ${placeholders})
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ${updatesSql}, updated_date = NOW()`,
      [
        String(updated.id),
        updated,
        updated.created_date || nowIso(),
        ...stationColumnValues(updated),
        ...commodityColumnValues(updated),
        ...dateValues,
      ]
    );
    return updated;
  }

  if (USER_PROFILE_ENTITIES.has(entityName)) {
    const createdAt = updated.created_at || updated.created_date || nowIso();
    const createdColumn =
      entityName === "UserNotificationPreference"
        ? "created_date"
        : "created_at";
    const extraColumns =
      entityName === "UserNotificationPreference"
        ? [
            "user_id",
            "inward_enabled",
            "outward_enabled",
            "delayed_enabled",
            "missing_match_enabled",
            "duplicate_enabled",
            "new_movement_enabled",
          ]
        : entityName === "UserWatchlist"
        ? ["user_id", "station_code", "station_name"]
        : ["user_id", "name"];
    const columnsSql = extraColumns.join(", ");
    const placeholders = extraColumns
      .map((_, index) => `$${index + 4}`)
      .join(", ");
    const updatesSql = extraColumns
      .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
      .join(", ");

    await pool.query(
      `INSERT INTO ${tableName} (id, data, ${createdColumn}, updated_date, ${columnsSql})
       VALUES ($1, $2, $3, NOW(), ${placeholders})
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ${updatesSql}, updated_date = NOW()`,
      [
        String(updated.id),
        updated,
        createdAt,
        ...extraColumns.map((columnName) =>
          typeof updated?.[columnName] === "boolean"
            ? updated[columnName]
            : updated?.[columnName] == null
            ? null
            : String(updated[columnName])
        ),
      ]
    );
    return { ...updated, created_at: createdAt };
  }

  if (entityName === "notification_history") {
    const createdAt = updated.created_at || nowIso();
    await pool.query(
      `INSERT INTO notification_history (
         id,
         event_key,
         notification_type,
         station_code,
         movement_reference,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_key) DO UPDATE SET
         notification_type = EXCLUDED.notification_type,
         station_code = EXCLUDED.station_code,
         movement_reference = EXCLUDED.movement_reference`,
      [
        String(updated.id),
        String(updated.event_key || ""),
        String(updated.notification_type || ""),
        updated.station_code == null ? null : String(updated.station_code),
        updated.movement_reference == null
          ? null
          : String(updated.movement_reference),
        createdAt,
      ]
    );
    return { ...updated, created_at: createdAt };
  }

  await pool.query(
    `INSERT INTO ${tableName} (id, data, created_date, updated_date)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_date = NOW()`,
    [String(updated.id), updated, updated.created_date || nowIso()]
  );
  return updated;
}

export async function deleteRecord(entityName, id) {
  assertEntity(entityName);
  if (activeStorage !== "postgres") return jsonDeleteRecord(entityName, id);

  const tableName = ENTITY_TABLES[entityName];
  const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [
    String(id),
  ]);
  return { deletedId: id, count: result.rowCount };
}

export async function countTables() {
  if (activeStorage !== "postgres") return null;

  const tableNames = ["users", ...Object.values(ENTITY_TABLES)];
  const counts = {};
  for (const tableName of tableNames) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ${tableName}`
    );
    counts[tableName] = result.rows[0].count;
  }
  return counts;
}

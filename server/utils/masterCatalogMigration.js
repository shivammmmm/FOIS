const GENERIC_MASTER_TABLES = [
  "state_master",
  "district_master",
  "zone_master",
  "division_master",
];

const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;

function q(identifier) {
  if (!SAFE_IDENTIFIER_RE.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function tableExists(pool, tableName) {
  const result = await pool.query("SELECT to_regclass($1) AS name", [tableName]);
  return Boolean(result.rows[0]?.name);
}

async function getColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function addColumn(pool, tableName, columns, columnName, definition) {
  const missing = !columns.has(columnName);
  await pool.query(
    `ALTER TABLE ${q(tableName)} ADD COLUMN IF NOT EXISTS ${q(columnName)} ${definition}`
  );
  if (missing) columns.add(columnName);
  return missing;
}

async function ensureTimestampColumns(pool, tableName, columns) {
  let applied = false;
  applied =
    (await addColumn(
      pool,
      tableName,
      columns,
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    )) || applied;
  applied =
    (await addColumn(
      pool,
      tableName,
      columns,
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    )) || applied;
  return applied;
}

export async function ensureGenericMasterTable(pool, tableName) {
  const existed = await tableExists(pool, tableName);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${q(tableName)} (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT,
      parent_code TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columns = await getColumns(pool, tableName);
  let applied = !existed;
  applied = (await addColumn(pool, tableName, columns, "id", "TEXT")) || applied;
  applied = (await addColumn(pool, tableName, columns, "code", "TEXT")) || applied;
  applied = (await addColumn(pool, tableName, columns, "name", "TEXT")) || applied;
  applied =
    (await addColumn(pool, tableName, columns, "parent_code", "TEXT")) ||
    applied;
  applied =
    (await addColumn(
      pool,
      tableName,
      columns,
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    )) || applied;
  applied = (await ensureTimestampColumns(pool, tableName, columns)) || applied;

  await pool.query(`
    UPDATE ${q(tableName)}
       SET code = COALESCE(NULLIF(code, ''), id),
           name = COALESCE(NULLIF(name, ''), code, id),
           active = COALESCE(active, TRUE)
     WHERE code IS NULL
        OR code = ''
        OR name IS NULL
        OR name = ''
        OR active IS NULL
  `);
  await pool.query(`ALTER TABLE ${q(tableName)} ALTER COLUMN code SET NOT NULL`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_code_uidx ON ${q(tableName)} (code)`
  );

  return applied;
}

export async function ensureStationMasterTable(pool) {
  const tableName = "station_master";
  const existed = await tableExists(pool, tableName);
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

  const columns = await getColumns(pool, tableName);
  let applied = !existed;
  for (const [columnName, definition] of [
    ["id", "TEXT"],
    ["station_code", "TEXT"],
    ["station_name", "TEXT"],
    ["district", "TEXT"],
    ["state", "TEXT"],
    ["division", "TEXT"],
    ["zone", "TEXT"],
    ["is_active", "BOOLEAN NOT NULL DEFAULT TRUE"],
  ]) {
    applied =
      (await addColumn(pool, tableName, columns, columnName, definition)) ||
      applied;
  }
  applied = (await ensureTimestampColumns(pool, tableName, columns)) || applied;

  await pool.query(`
    UPDATE station_master
       SET station_code = COALESCE(NULLIF(station_code, ''), id),
           station_name = COALESCE(NULLIF(station_name, ''), station_code, id),
           is_active = COALESCE(is_active, TRUE)
     WHERE station_code IS NULL
        OR station_code = ''
        OR station_name IS NULL
        OR station_name = ''
        OR is_active IS NULL
  `);
  await pool.query("ALTER TABLE station_master ALTER COLUMN station_code SET NOT NULL");
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS station_master_station_code_uidx ON station_master (station_code)"
  );

  return applied;
}

export async function ensureCommodityCatalogTable(pool) {
  const tableName = "commodity_master";
  const existed = await tableExists(pool, tableName);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commodity_master (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'Commodity',
      commodity_code TEXT,
      commodity_name TEXT,
      commodity_group_code TEXT,
      commodity_group_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columns = await getColumns(pool, tableName);
  let applied = !existed;
  for (const [columnName, definition] of [
    ["id", "TEXT"],
    ["code", "TEXT"],
    ["name", "TEXT"],
    ["type", "TEXT NOT NULL DEFAULT 'Commodity'"],
    ["commodity_code", "TEXT"],
    ["commodity_name", "TEXT"],
    ["commodity_group_code", "TEXT"],
    ["commodity_group_name", "TEXT"],
    ["is_active", "BOOLEAN NOT NULL DEFAULT TRUE"],
  ]) {
    applied =
      (await addColumn(pool, tableName, columns, columnName, definition)) ||
      applied;
  }
  applied = (await ensureTimestampColumns(pool, tableName, columns)) || applied;

  await pool.query(`
    UPDATE commodity_master
       SET code = COALESCE(NULLIF(code, ''), NULLIF(commodity_code, ''), id),
           name = COALESCE(NULLIF(name, ''), NULLIF(commodity_name, ''), code, commodity_code, id),
           commodity_code = COALESCE(NULLIF(commodity_code, ''), NULLIF(code, ''), id),
           commodity_name = COALESCE(NULLIF(commodity_name, ''), NULLIF(name, ''), code, commodity_code, id),
           type = COALESCE(NULLIF(type, ''), 'Commodity'),
           is_active = COALESCE(is_active, TRUE)
     WHERE code IS NULL
        OR code = ''
        OR name IS NULL
        OR name = ''
        OR commodity_code IS NULL
        OR commodity_code = ''
        OR commodity_name IS NULL
        OR commodity_name = ''
        OR type IS NULL
        OR type = ''
        OR is_active IS NULL
  `);

  await pool.query("ALTER TABLE commodity_master ALTER COLUMN code SET NOT NULL");
  await pool.query("ALTER TABLE commodity_master ALTER COLUMN type SET NOT NULL");
  await pool.query(
    "ALTER TABLE commodity_master DROP CONSTRAINT IF EXISTS commodity_master_code_key"
  );
  await pool.query(
    "ALTER TABLE commodity_master DROP CONSTRAINT IF EXISTS commodity_master_commodity_code_key"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS commodity_master_code_type_uidx ON commodity_master (code, type)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS commodity_master_type_idx ON commodity_master (type)"
  );

  return applied;
}

export async function ensureMasterCatalogSchema(pool) {
  let applied = false;
  for (const tableName of GENERIC_MASTER_TABLES) {
    applied = (await ensureGenericMasterTable(pool, tableName)) || applied;
  }
  applied = (await ensureStationMasterTable(pool)) || applied;
  applied = (await ensureCommodityCatalogTable(pool)) || applied;
  return { applied };
}

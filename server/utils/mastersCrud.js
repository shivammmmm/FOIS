import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

const pool = new Pool({ connectionString: DATABASE_URL });

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeName(code) {
  return String(code || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureMasterTables() {
  // zone_master / division_master / state_master / district_master
  // Created by storage.js in the postgres flow, but keep defensive creation.
  for (const tableName of [
    "zone_master",
    "division_master",
    "state_master",
    "district_master",
  ]) {
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
  }
}

async function upsertMaster({ table, code, name, parentCode }) {
  const t = table;
  if (!code) return { created: 0 };
  const normalizedCode = normalizeCode(code);
  const normalizedName = normalizeName(name || code);

  // Deterministic id to avoid gen_random_uuid dependency.
  const id = `${t}_${normalizedCode}`;

  // Use ON CONFLICT to update name/parent.
  const res = await pool.query(
    `INSERT INTO ${t} (id, code, name, parent_code, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,TRUE,NOW(),NOW())
     ON CONFLICT (code) DO UPDATE SET
       name=EXCLUDED.name,
       parent_code=EXCLUDED.parent_code,
       active=TRUE,
       updated_at=NOW()
     RETURNING (xmax = 0) AS inserted;
    `,
    [id, normalizedCode, normalizedName || null, parentCode || null]
  );

  const inserted = res.rows?.[0]?.inserted;
  return { created: inserted ? 1 : 0 };
}

async function upsertHierarchyMasters({ zone, division, state, district }) {
  await ensureMasterTables();

  const z = zone ? String(zone).trim() : "";
  const d = division ? String(division).trim() : "";
  const s = state ? String(state).trim() : "";
  const di = district ? String(district).trim() : "";

  // Phase 6A: auto-create masters. Store relationships as parent_code.
  // zone -> division(parent_code = zone)
  // state -> district(parent_code = state)

  const [zoneRes, divisionRes, stateRes, districtRes] = await Promise.all([
    upsertMaster({ table: "zone_master", code: z, name: z, parentCode: null }),
    upsertMaster({
      table: "division_master",
      code: d,
      name: d,
      parentCode: z ? normalizeCode(z) : null,
    }),
    upsertMaster({ table: "state_master", code: s, name: s, parentCode: null }),
    upsertMaster({
      table: "district_master",
      code: di,
      name: di,
      parentCode: s ? normalizeCode(s) : null,
    }),
  ]);

  return {
    zonesCreated: zoneRes.created,
    divisionsCreated: divisionRes.created,
    statesCreated: stateRes.created,
    districtsCreated: districtRes.created,
  };
}

export async function listStations({ search, offset, limit }) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS station_master (
        id TEXT PRIMARY KEY,
        station_code TEXT UNIQUE NOT NULL,
        station_name TEXT NOT NULL,
        district TEXT,
        state TEXT,
        division TEXT,
        zone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(station_code)
      )
    `);

    const searchTerm = search?.trim() || "";
    const safeLimit =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 50;
    const safeOffset =
      Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

    if (!searchTerm) {
      const rows = await pool.query(
        `SELECT id, station_code, station_name, district, state, division, zone, is_active, created_at, updated_at
         FROM station_master
         ORDER BY station_code ASC
         OFFSET $1::integer LIMIT $2::integer`,
        [safeOffset, safeLimit]
      );

      const totalRes = await pool.query(
        `SELECT COUNT(*)::int as count FROM station_master`
      );

      return { items: rows.rows, total: totalRes.rows[0]?.count || 0 };
    }

    const searchPattern = `%${searchTerm}%`;
    const where = `WHERE station_code ILIKE $1::text OR station_name ILIKE $1::text OR district ILIKE $1::text OR state ILIKE $1::text OR division ILIKE $1::text OR zone ILIKE $1::text`;
    const rows = await pool.query(
      `SELECT id, station_code, station_name, district, state, division, zone, is_active, created_at, updated_at
       FROM station_master
       ${where}
       ORDER BY station_code ASC
       OFFSET $2::integer LIMIT $3::integer`,
      [searchPattern, safeOffset, safeLimit]
    );

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM station_master ${where}`,
      [searchPattern]
    );

    return { items: rows.rows, total: totalRes.rows[0]?.count || 0 };
  } catch (error) {
    console.error("Failed to list station_master", error);
    return { items: [], total: 0 };
  }
}

export async function getStationById(id) {
  const rows = await pool.query(
    `SELECT id, station_code, station_name, district, state, division, zone, is_active, created_at, updated_at
     FROM station_master WHERE id=$1 LIMIT 1`,
    [id]
  );
  return rows.rows[0] || null;
}

export async function createOrUpdateStation(payload) {
  const station_code = normalizeCode(payload.station_code);
  if (!station_code) throw new Error("station_code is required");
  const station_name = String(payload.station_name || "").trim();
  if (!station_name) throw new Error("station_name is required");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS station_master (
      id TEXT PRIMARY KEY,
      station_code TEXT UNIQUE NOT NULL,
      station_name TEXT NOT NULL,
      district TEXT,
      state TEXT,
      division TEXT,
      zone TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(station_code)
    )
  `);

  // Phase 6A: auto-upsert masters from incoming station row.
  const hierarchy = await upsertHierarchyMasters({
    zone: payload.zone,
    division: payload.division,
    state: payload.state,
    district: payload.district,
  });

  // We don't have gen_random_uuid extension guarantee. Use composite id fallback.
  const id = payload.id || `st_${station_code}`;

  await pool.query(
    `INSERT INTO station_master (id, station_code, station_name, district, state, division, zone, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     ON CONFLICT (station_code) DO UPDATE SET
       station_name=EXCLUDED.station_name,
       district=EXCLUDED.district,
       state=EXCLUDED.state,
       division=EXCLUDED.division,
       zone=EXCLUDED.zone,
       is_active=EXCLUDED.is_active,
       updated_at=NOW()`,
    [
      id,
      station_code,
      station_name,
      payload.district || null,
      payload.state || null,
      payload.division || null,
      payload.zone || null,
      payload.is_active !== undefined ? !!payload.is_active : true,
    ]
  );

  const updated = await getStationById(id);
  return { ...(updated || { id, station_code, station_name }), ...hierarchy };
}

export async function deleteStationById(id) {
  const res = await pool.query(`DELETE FROM station_master WHERE id=$1`, [id]);
  return { deletedId: id, count: res.rowCount };
}




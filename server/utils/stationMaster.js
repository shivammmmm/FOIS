import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

// Lightweight DB access for master lookups & unmapped recording.
const pool = new Pool({ connectionString: DATABASE_URL });

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

export async function upsertUnmappedStationCodes(codes, { batchId } = {}) {
  const unique = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (unique.length === 0) return { inserted: 0, updated: 0, total: 0 };


  // Ensure table exists (defensive; storage.js should create it).
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

  // Upsert by station_code (we store station_name for future UX if provided later)
  // We need id/first_seen/last_seen/occurrence_count/status.
  // Use deterministic id to avoid gen_random_uuid dependency.
  const insertedOrUpdated = await pool.query(
    `WITH input_codes AS (
      SELECT unnest($1::text[]) AS station_code
    ), up AS (
      INSERT INTO unmapped_station_codes (
        id,
        station_code,
        station_name,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        status
      )
      SELECT
        ('unmapped_' || station_code) AS id,
        station_code,
        NULL AS station_name,
        NOW() AS first_seen_at,
        NOW() AS last_seen_at,
        1 AS occurrence_count,
        'unmapped' AS status
      FROM input_codes
      ON CONFLICT (station_code) DO UPDATE SET
        last_seen_at = NOW(),
        occurrence_count = unmapped_station_codes.occurrence_count + 1,
        status = 'unmapped',
        updated_at = NOW(),
        station_name = COALESCE(unmapped_station_codes.station_name, EXCLUDED.station_name)
      RETURNING station_code
    )
    SELECT count(*)::int AS cnt FROM up;`,
    [unique]
  );

  const cnt = insertedOrUpdated.rows[0]?.cnt || 0;
  return { total: unique.length, insertedOrUpdated: cnt };
}

function safeNow() { return new Date().toISOString(); }

export async function bulkLookupStationMasters(codes) {
  const unique = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (unique.length === 0) return {};

  // Ensure table exists (defensive; storage.js should create it).
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

  const result = await pool.query(
    `SELECT station_code, station_name, district, state, division, zone, is_active
     FROM station_master
     WHERE station_code = ANY($1::text[])`,
    [unique]
  );

  const map = {};
  for (const row of result.rows) {
    map[row.station_code] = {
      station_code: row.station_code,
      station_name: row.station_name,
      district: row.district,
      state: row.state,
      division: row.division,
      zone: row.zone,
      is_active: row.is_active,
    };
  }
  return map;
}


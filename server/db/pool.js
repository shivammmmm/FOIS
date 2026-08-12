import pg from "pg";
const { Pool } = pg;

export const primaryUrl =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@187.127.150.120:5432/fois_db";

export const pool = new Pool({
  connectionString: primaryUrl,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function getDbPool() {
  const client = await pool.connect();
  await client.query("SELECT 1");
  client.release();
  console.log("✓ Connected to Live Server PostgreSQL (187.127.150.120)");
  return pool;
}

import "../server/loadEnv.js";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const statuses = await pool.query(
    "SELECT status, COUNT(*)::int count FROM odr_matured_matches GROUP BY status ORDER BY status"
  );
  const duplicateAssignments = await pool.query(`
    SELECT COUNT(*)::int AS duplicate_matured_assignments
    FROM (
      SELECT matured_id FROM odr_matured_matches
      WHERE matured_id IS NOT NULL AND status IN ('Matched','Partial')
      GROUP BY matured_id HAVING COUNT(*) > 1
    ) duplicate_assignments
  `);
  const incorrectNumberOnly = await pool.query(`
    SELECT COUNT(*)::int AS incorrect_no_only_matches
    FROM odr_matured_matches m
    JOIN freight_movements f ON f.id = m.odr_id
    JOIN matured_indents i ON i.id = m.matured_id
    WHERE m.status IN ('Matched','Partial')
      AND (
        UPPER(TRIM(f.data->>'division')) IS DISTINCT FROM UPPER(TRIM(i.data->>'division'))
        OR UPPER(TRIM(f.data->>'station_from')) IS DISTINCT FROM UPPER(TRIM(i.data->>'station_from'))
        OR UPPER(TRIM(f.data->>'station_to')) IS DISTINCT FROM UPPER(TRIM(i.data->>'station_to'))
        OR UPPER(TRIM(COALESCE(f.data->>'company',f.data->>'company_code','')))
           IS DISTINCT FROM UPPER(TRIM(COALESCE(i.data->>'company',i.data->>'company_code','')))
      )
  `);
  console.log(JSON.stringify({
    statuses: statuses.rows,
    ...duplicateAssignments.rows[0],
    ...incorrectNumberOnly.rows[0],
  }, null, 2));
} finally {
  await pool.end();
}

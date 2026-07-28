import "../server/loadEnv.js";
import { Pool } from "pg";

const shouldDelete = process.argv.includes("--apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const predicate = `
  UPPER(COALESCE(data->>'division','')) IN ('DVSN','DIVISION')
  OR UPPER(COALESCE(data->>'station_from','')) IN ('STTN FROM','STATION FROM','FROM STATION')
  OR UPPER(COALESCE(data->>'odr_number',data->>'indent_number',''))
     IN ('NO.','NO','DEMAND NO.','DEMAND NO','INDENT NO.','INDENT NO')
`;
try {
  const result = {};
  for (const table of ["freight_movements", "matured_indents"]) {
    const count = await pool.query(`SELECT COUNT(*)::int count FROM ${table} WHERE ${predicate}`);
    result[table] = { found: count.rows[0].count, deleted: 0 };
    if (shouldDelete && count.rows[0].count) {
      const removed = await pool.query(`DELETE FROM ${table} WHERE ${predicate}`);
      result[table].deleted = removed.rowCount;
    }
  }
  console.log(JSON.stringify({ mode: shouldDelete ? "apply" : "dry-run", ...result }, null, 2));
} finally {
  await pool.end();
}

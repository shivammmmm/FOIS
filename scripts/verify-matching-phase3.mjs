import "../server/loadEnv.js";
import { Pool } from "pg";
import { runMatchingEngine } from "../server/services/matchingEngine.js";
import {
  comparisonAnalytics,
  comparisonRecords,
  userFreightSummary,
} from "../server/services/comparisonService.js";

const summary = await runMatchingEngine({
  requestedBy: "Phase 3 verification",
  trigger: "phase3-verification",
  emitNotifications: false,
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const checks = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT matured_id FROM odr_matured_matches
        WHERE matured_id IS NOT NULL AND status IN ('Matched','Partial','Completed')
        GROUP BY matured_id HAVING COUNT(*) > 1
      ) duplicate_rows)::int AS duplicate_assignments,
      (SELECT COUNT(*) FROM odr_matured_matches m
        LEFT JOIN freight_movements f ON f.id=m.odr_id
        LEFT JOIN matured_indents i ON i.id=m.matured_id
        WHERE (m.odr_id IS NOT NULL AND f.id IS NULL)
           OR (m.matured_id IS NOT NULL AND i.id IS NULL))::int AS orphan_matches,
      (SELECT COUNT(*) FROM freight_lifecycle_events)::int AS lifecycle_events,
      (SELECT COUNT(*) FROM matching_runs)::int AS matching_runs
  `);
  const [admin, user, analytics] = await Promise.all([
    comparisonRecords({}, { page: 1, limit: 5 }),
    userFreightSummary({}, {}),
    comparisonAnalytics({}),
  ]);
  console.log(JSON.stringify({
    summary,
    checks: checks.rows[0],
    admin_total: admin.total,
    user_total: user.total_demands,
    analytics_status_total: analytics.status_distribution.reduce((sum, row) => sum + row.value, 0),
  }, null, 2));
} finally {
  await pool.end();
}

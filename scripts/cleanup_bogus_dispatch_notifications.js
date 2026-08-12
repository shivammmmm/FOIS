/**
 * One-time cleanup for notifications wrongly created by the now-removed
 * matchingEngine.js "Rake Dispatched" pipeline (removed 2026-08-12).
 *
 * That pipeline fired title "🚆 Rake Dispatched: <rakeId>" for any fuzzy
 * match_status of Matched/Partial/Completed, regardless of a real MET WITH
 * DATE. The legitimate pipeline (server/index.js) uses a different title,
 * "🚆 Rack Matured / Dispatched: <rakeId>" (note "Rack", not "Rake"), so the
 * two are distinguishable by title text alone.
 *
 * Usage:
 *   node scripts/cleanup_bogus_dispatch_notifications.js           (dry run, no writes)
 *   node scripts/cleanup_bogus_dispatch_notifications.js --apply   (deletes rows)
 */
import { pool } from "../server/db/pool.js";

const APPLY = process.argv.includes("--apply");
const BOGUS_TITLE_PREFIX = "🚆 Rake Dispatched:";

async function main() {
  console.log("==================================================");
  console.log(`BOGUS "RAKE DISPATCHED" NOTIFICATION CLEANUP ${APPLY ? "(APPLY)" : "(DRY RUN)"}`);
  console.log("==================================================\n");

  const client = await pool.connect();
  try {
    const matchQuery = await client.query(
      `SELECT id, data->>'title' AS title, created_date
       FROM rail_notifications
       WHERE data->>'title' LIKE $1`,
      [`${BOGUS_TITLE_PREFIX}%`]
    );

    console.log(`Found ${matchQuery.rows.length} bogus RailNotification rows.`);
    if (matchQuery.rows.length > 0) {
      console.log("Sample:", matchQuery.rows.slice(0, 5).map((r) => r.title));
    }

    const historyQuery = await client.query(
      `SELECT id FROM notification_history WHERE notification_type = 'RakeDispatched'`
    );
    console.log(`Found ${historyQuery.rows.length} matching notification_history rows (notification_type='RakeDispatched').`);

    if (!APPLY) {
      console.log("\nDry run only - no rows deleted. Re-run with --apply to delete.");
      return;
    }

    const deletedNotifs = await client.query(
      `DELETE FROM rail_notifications WHERE data->>'title' LIKE $1`,
      [`${BOGUS_TITLE_PREFIX}%`]
    );
    const deletedHistory = await client.query(
      `DELETE FROM notification_history WHERE notification_type = 'RakeDispatched'`
    );

    console.log(`\nDeleted ${deletedNotifs.rowCount} rail_notifications rows.`);
    console.log(`Deleted ${deletedHistory.rowCount} notification_history rows.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exitCode = 1;
});

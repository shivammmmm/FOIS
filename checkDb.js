import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db"
});

async function main() {
  try {
    const states = await pool.query("SELECT COUNT(*) FROM state_master");
    console.log("State Master Count:", states.rows[0].count);
  } catch (e) {
    console.error("State Master Error:", e.message);
  }

  try {
    const districts = await pool.query("SELECT COUNT(*) FROM district_master");
    console.log("District Master Count:", districts.rows[0].count);
  } catch (e) {
    console.error("District Master Error:", e.message);
  }

  try {
    const stations = await pool.query("SELECT COUNT(*) FROM station_master");
    console.log("Station Master Count:", stations.rows[0].count);
  } catch (e) {
    console.error("Station Master Error:", e.message);
  }

  await pool.end();
}

main();

# District/State seeding plan (802 districts / 29 states)

## Goal
Populate DB tables `state_master` and `district_master` with a complete dataset (29 states + ~802 districts) so UI doesn’t need runtime creation.

## Steps
1. Replace `INDIA_DATA` inside `scripts/seedMasters.js` with a full dataset.
2. Gate seeder execution in `server/index.js` (RUN_SEEDER env flag) so it runs once.
3. Run seeder (dev first).
4. Verify:
   - `SELECT COUNT(*) FROM state_master;`
   - `SELECT COUNT(*) FROM district_master;`
5. Smoke test: open pages that depend on state_master/district_master.


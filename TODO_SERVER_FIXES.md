# Server fixes TODO (masters endpoints)

- [ ] Step 1: Locate duplicate GET `/api/masters/states` handlers and confirm which one is the intended authenticated-only handler.
- [ ] Step 2: Deduplicate so exactly one `/api/masters/states` handler remains, using `requireAuth` and reading from `state_master`.
- [ ] Step 3: Add missing Auth-only GET `/api/masters/districts` endpoint that returns `{ items, count }` and filters dynamically for `state_id` or `state_code` using columns that exist in `district_master`.
- [ ] Step 4: Verify custom date filter query placeholder indexes ($1..$N) are consistent with `finalParams` length; ensure LIMIT/OFFSET use last indexes.
- [ ] Step 5: Run repo compile/start checks (lint/tests/build) and ensure server boots.


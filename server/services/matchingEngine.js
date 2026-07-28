import crypto from "crypto";
import { Pool } from "pg";
import { createNotification } from "../notifications/service.js";
import { matchedLifecycleStatus } from "./lifecycleStatus.js";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

export const MATCH_FIELDS = [
  "number",
  "division",
  "station_from",
  "station_to",
  "company",
  "commodity",
  "demand_date",
];

const CORE_FIELDS = MATCH_FIELDS.slice(0, 5);
const MATCH_LOCK_ID = 70422119;
export const DEFAULT_RULES = {
  version: "3.0",
  required_exact_fields: ["division", "station_from", "station_to", "company", "commodity"],
  strong_fields: ["number", "demand_date", "cnsg", "rake_cmdt"],
  verification_fields: ["indented_units"],
  date_tolerance_days: 7,
  unit_tolerance: 0,
  auto_match_threshold: 90,
  manual_review_threshold: 75,
  case_normalization: true,
  leading_zero_handling: "preserve",
  blank_value_policy: "allow_but_flag",
};

function normalize(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : normalize(text);
}

function businessRecord(row, type) {
  const data = row.data || {};
  return {
    id: String(row.id),
    raw: data,
    number: normalize(type === "odr" ? data.odr_number : data.indent_number),
    division: normalize(data.division),
    station_from: normalize(data.station_from),
    station_to: normalize(data.station_to),
    company: normalize(data.company || data.company_code),
    commodity: normalize(data.commodity || data.commodity_code),
    cnsg: normalize(data.cnsg || data.raw_data?.cnsg),
    rake_cmdt: normalize(data.rake_cmdt || data.rake_commodity_code || data.raw_data?.["Rake CMDT"]),
    demand_date: normalizeDate(
      type === "odr" ? data.departure_date : data.indent_date
    ),
    batch: String(data.upload_batch_id || data.batch_id || ""),
  };
}

function keyOf(record, fields = MATCH_FIELDS) {
  return fields.map((field) => record[field]).join("\u001f");
}

function groupBy(records, keyBuilder) {
  const map = new Map();
  for (const record of records) {
    const key = keyBuilder(record);
    const list = map.get(key);
    if (list) list.push(record);
    else map.set(key, [record]);
  }
  return map;
}

function dayDifference(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b)
    ? Math.abs(a - b) / 86400000
    : Number.POSITIVE_INFINITY;
}

function candidateResult(odr, candidate, rules = DEFAULT_RULES) {
  if (keyOf(odr) === keyOf(candidate)) {
    return { confidence: 100, method: "Composite Exact", reason: "Exact Match", status: "Matched" };
  }
  let confidence = 70;
  const reasons = [];
  if (odr.number && odr.number === candidate.number) confidence += 15;
  else reasons.push("NO. Difference");
  const dateDiff = dayDifference(odr.demand_date, candidate.demand_date);
  if (dateDiff === 0) confidence += 10;
  else if (dateDiff <= Number(rules.date_tolerance_days || 7)) {
    confidence += 7; reasons.push("Date Difference");
  } else reasons.push("Date Outside Tolerance");
  if (odr.cnsg && odr.cnsg === candidate.cnsg) confidence += 3;
  if (odr.rake_cmdt && odr.rake_cmdt === candidate.rake_cmdt) confidence += 2;
  if (confidence < Number(rules.manual_review_threshold || 75)) return null;
  return {
    confidence,
    method: confidence >= Number(rules.auto_match_threshold || 90) ? "Configured Composite Score" : "Configured Candidate",
    reason: reasons.join("; ") || "Strong fields matched",
    status: "Matched",
  };
}

function createResult({ odr = null, matured = null, status, confidence = 0, method = "None", reason }) {
  return {
    match_id: crypto.randomUUID(),
    odr_id: odr?.id || null,
    matured_id: matured?.id || null,
    status,
    match_method: method,
    confidence,
    matched_on: ["Matched", "Partial"].includes(status) ? new Date().toISOString() : null,
    matched_by: "System",
    batch_odr: odr?.batch || null,
    batch_matured: matured?.batch || null,
    reason,
  };
}

export async function ensureMatchingSchema(clientOrPool = null) {
  const ownsPool = !clientOrPool;
  const db = clientOrPool || new Pool({ connectionString: DATABASE_URL });
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS odr_matured_matches (
        match_id UUID PRIMARY KEY,
        odr_id TEXT REFERENCES freight_movements(id) ON DELETE CASCADE,
        matured_id TEXT REFERENCES matured_indents(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        match_method TEXT NOT NULL,
        confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
        matched_on TIMESTAMPTZ,
        matched_by TEXT,
        batch_odr TEXT,
        batch_matured TEXT,
        reason TEXT,
        match_rule_version TEXT NOT NULL DEFAULT '3.0',
        manual_locked BOOLEAN NOT NULL DEFAULT FALSE,
        manual_match BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT,
        previous_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_odr_idx ON odr_matured_matches (odr_id)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_matured_idx ON odr_matured_matches (matured_id)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_status_idx ON odr_matured_matches (status)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_batch_odr_idx ON odr_matured_matches (batch_odr)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_batch_matured_idx ON odr_matured_matches (batch_matured)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_confidence_idx ON odr_matured_matches (confidence)");
    await db.query("CREATE INDEX IF NOT EXISTS odr_matured_matches_matched_on_idx ON odr_matured_matches (matched_on DESC)");
    for (const [column, definition] of [
      ["match_rule_version", "TEXT NOT NULL DEFAULT '3.0'"],
      ["manual_locked", "BOOLEAN NOT NULL DEFAULT FALSE"],
      ["manual_match", "BOOLEAN NOT NULL DEFAULT FALSE"],
      ["resolved_by", "TEXT"],
      ["resolved_at", "TIMESTAMPTZ"],
      ["resolution_note", "TEXT"],
      ["previous_status", "TEXT"],
    ]) await db.query(`ALTER TABLE odr_matured_matches ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS matching_rule_config (
        id TEXT PRIMARY KEY DEFAULT 'active',
        version TEXT NOT NULL,
        config JSONB NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(
      `INSERT INTO matching_rule_config (id, version, config)
       VALUES ('active', $1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_RULES.version, JSON.stringify(DEFAULT_RULES)]
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS matching_runs (
        run_id UUID PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        trigger_type TEXT NOT NULL,
        triggered_by TEXT,
        scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        rule_version TEXT,
        odr_scanned INTEGER NOT NULL DEFAULT 0,
        matured_scanned INTEGER NOT NULL DEFAULT 0,
        matched INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0,
        partial INTEGER NOT NULL DEFAULT 0,
        ambiguous INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        error_message TEXT
      )
    `);
    await db.query("CREATE INDEX IF NOT EXISTS matching_runs_started_idx ON matching_runs (started_at DESC)");
    await db.query(`
      CREATE TABLE IF NOT EXISTS freight_lifecycle_events (
        event_id UUID PRIMARY KEY,
        odr_id TEXT NOT NULL REFERENCES freight_movements(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        status_version TEXT NOT NULL,
        units NUMERIC,
        batch_reference TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (odr_id, event_type, status_version)
      )
    `);
    await db.query("CREATE INDEX IF NOT EXISTS freight_movements_match_exact_idx ON freight_movements ((UPPER(COALESCE(data->>'odr_number',''))), (UPPER(COALESCE(data->>'division',''))), (UPPER(COALESCE(data->>'station_from',''))), (UPPER(COALESCE(data->>'station_to',''))), (UPPER(COALESCE(data->>'company',''))))");
    await db.query("CREATE INDEX IF NOT EXISTS matured_indents_match_exact_idx ON matured_indents ((UPPER(COALESCE(data->>'indent_number',''))), (UPPER(COALESCE(data->>'division',''))), (UPPER(COALESCE(data->>'station_from',''))), (UPPER(COALESCE(data->>'station_to',''))), (UPPER(COALESCE(data->>'company',''))))");
  } finally {
    if (ownsPool) await db.end();
  }
}

async function insertResults(client, results) {
  const chunkSize = 2000;
  for (let start = 0; start < results.length; start += chunkSize) {
    const chunk = results.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk.map((item, rowIndex) => {
      const offset = rowIndex * 19;
      values.push(
        item.match_id, item.odr_id, item.matured_id, item.status,
        item.match_method, item.confidence, item.matched_on, item.matched_by,
        item.batch_odr, item.batch_matured, item.reason, item.match_rule_version || DEFAULT_RULES.version,
        Boolean(item.manual_locked), Boolean(item.manual_match), item.resolved_by, item.resolved_at,
        item.resolution_note, item.previous_status, new Date().toISOString()
      );
      return `(${Array.from({ length: 19 }, (_, i) => `$${offset + i + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO odr_matured_matches
       (match_id, odr_id, matured_id, status, match_method, confidence, matched_on,
        matched_by, batch_odr, batch_matured, reason, match_rule_version,
        manual_locked, manual_match, resolved_by, resolved_at, resolution_note, previous_status, created_at)
       VALUES ${placeholders.join(",")}`,
      values
    );
  }
}

export async function runMatchingEngine({
  requestedBy = "System", trigger = "reprocess", scope = { type: "all" },
  resetManualDecisions = false, emitNotifications = true,
} = {}) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  let notificationEvents = [];
  try {
    await ensureMatchingSchema(client);
    const ruleQuery = await client.query("SELECT version, config FROM matching_rule_config WHERE id='active'");
    const rules = { ...DEFAULT_RULES, ...(ruleQuery.rows[0]?.config || {}) };
    rules.version = ruleQuery.rows[0]?.version || rules.version;
    await client.query(
      `INSERT INTO matching_runs (run_id, started_at, trigger_type, triggered_by, scope, rule_version, status)
       VALUES ($1, NOW(), $2, $3, $4::jsonb, $5, 'Running')`,
      [runId, trigger, requestedBy, JSON.stringify(scope || { type: "all" }), rules.version]
    );
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MATCH_LOCK_ID]);
    console.info("[Matching] Matching Started", { trigger, requestedBy });

    const [odrQuery, maturedQuery] = await Promise.all([
      client.query("SELECT id, data FROM freight_movements"),
      client.query("SELECT id, data FROM matured_indents"),
    ]);
    const odrs = odrQuery.rows.map((row) => businessRecord(row, "odr"));
    const matured = maturedQuery.rows.map((row) => businessRecord(row, "matured"));
    const protectedQuery = resetManualDecisions
      ? { rows: [] }
      : await client.query("SELECT * FROM odr_matured_matches WHERE manual_locked = TRUE");
    const protectedByOdr = new Map(protectedQuery.rows.filter((row) => row.odr_id).map((row) => [row.odr_id, row]));
    const protectedMatured = new Set(protectedQuery.rows.map((row) => row.matured_id).filter(Boolean));
    const odrDuplicates = new Set();
    const maturedDuplicates = new Set();

    for (const group of groupBy(odrs, (row) => keyOf(row)).values()) {
      if (group.length > 1) group.forEach((row) => odrDuplicates.add(row.id));
    }
    for (const group of groupBy(matured, (row) => keyOf(row)).values()) {
      if (group.length > 1) group.forEach((row) => maturedDuplicates.add(row.id));
    }

    const eligibleMatured = matured.filter((row) => !maturedDuplicates.has(row.id) && !protectedMatured.has(row.id));
    const exactIndex = groupBy(eligibleMatured, (row) => keyOf(row));
    const requiredFields = Array.isArray(rules.required_exact_fields) && rules.required_exact_fields.length
      ? rules.required_exact_fields
      : CORE_FIELDS;
    const coreIndex = groupBy(eligibleMatured, (row) => keyOf(row, requiredFields));
    const proposals = [];
    const resultsByOdr = new Map();

    for (const odr of odrs) {
      if (protectedByOdr.has(odr.id)) {
        resultsByOdr.set(odr.id, protectedByOdr.get(odr.id));
        continue;
      }
      if (odrDuplicates.has(odr.id)) {
        resultsByOdr.set(odr.id, createResult({ odr, status: "Duplicate", reason: "Duplicate ODR business identity" }));
        continue;
      }
      const exact = exactIndex.get(keyOf(odr)) || [];
      const candidates = exact.length ? exact : (coreIndex.get(keyOf(odr, requiredFields)) || []);
      const qualified = candidates
        .map((candidate) => ({ candidate, score: candidateResult(odr, candidate, rules) }))
        .filter((item) => item.score);
      if (qualified.length === 0) {
        resultsByOdr.set(odr.id, createResult({ odr, status: "Pending", reason: "No composite candidate" }));
      } else if (qualified.length > 1) {
        resultsByOdr.set(odr.id, createResult({ odr, status: "Manual Review", reason: `${qualified.length} eligible Matured candidates` }));
      } else {
        const best = qualified[0];
        if (best.score.confidence < Number(rules.auto_match_threshold || 90)) {
          resultsByOdr.set(odr.id, createResult({
            odr, status: "Manual Review", confidence: best.score.confidence,
            method: best.score.method, reason: `${best.score.reason}; below auto-match threshold`,
          }));
        } else proposals.push({ odr, matured: best.candidate, ...best.score });
      }
    }

    const proposalsByMatured = groupBy(proposals, (item) => item.matured.id);
    for (const proposal of proposals) {
      const competing = proposalsByMatured.get(proposal.matured.id) || [];
      if (competing.length > 1) {
        resultsByOdr.set(proposal.odr.id, createResult({
          odr: proposal.odr, status: "Manual Review",
          reason: `${competing.length} ODR rows compete for one Matured row`,
        }));
      } else {
        const result = createResult(proposal);
        result.status = matchedLifecycleStatus(proposal.odr.raw, proposal.matured.raw, "Matched");
        result.match_rule_version = rules.version;
        result.matched_by = requestedBy || "System";
        resultsByOdr.set(proposal.odr.id, result);
      }
    }

    const usedMatured = new Set(
      [...resultsByOdr.values()].filter((item) => item.matured_id).map((item) => item.matured_id)
    );
    const results = [...resultsByOdr.values()];
    for (const indent of matured) {
      if (usedMatured.has(indent.id)) continue;
      results.push(createResult({
        matured: indent,
        status: maturedDuplicates.has(indent.id) ? "Duplicate" : "Unmatched",
        reason: maturedDuplicates.has(indent.id) ? "Duplicate Matured business identity" : "No matched ODR composite identity",
      }));
    }

    await client.query("DELETE FROM odr_matured_matches");
    await insertResults(client, results);
    await client.query(`
      UPDATE freight_movements fm
      SET data = jsonb_set(jsonb_set(fm.data, '{match_status}', to_jsonb(m.status), true),
                           '{odr_matched}', to_jsonb(m.status IN ('Matched','Partial')), true),
          updated_date = NOW()
      FROM odr_matured_matches m WHERE m.odr_id = fm.id
    `);
    await client.query(`
      UPDATE matured_indents mi
      SET data = jsonb_set(
                   jsonb_set(
                     jsonb_set(mi.data, '{match_status}', to_jsonb(m.status), true),
                     '{odr_matched}', to_jsonb(m.status IN ('Matched','Partial')), true),
                   '{matched_odr_number}', to_jsonb(COALESCE(fm.data->>'odr_number','')), true),
          updated_date = NOW()
      FROM odr_matured_matches m
      LEFT JOIN freight_movements fm ON fm.id = m.odr_id
      WHERE m.matured_id = mi.id
    `);
    await client.query("COMMIT");

    const odrById = new Map(odrs.map((row) => [row.id, row]));
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO freight_lifecycle_events
        (event_id, odr_id, event_type, status_version, units, batch_reference, message)
      SELECT gen_random_uuid(), m.odr_id,
        CASE m.status WHEN 'Matched' THEN 'Demand Matured' WHEN 'Partial' THEN 'Partial Supply Recorded'
          WHEN 'Completed' THEN 'Demand Completed' WHEN 'Manual Review' THEN 'Under Verification' ELSE 'Demand Created' END,
        CONCAT(m.status, ':', COALESCE(f.data->'raw_data'->>'supplied_units','0'), ':', COALESCE(m.matured_id,'')),
        CASE WHEN COALESCE(f.data->'raw_data'->>'supplied_units','') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (f.data->'raw_data'->>'supplied_units')::numeric ELSE NULL END,
        m.batch_odr,
        CASE m.status WHEN 'Matched' THEN 'Your demand has matured.'
          WHEN 'Partial' THEN 'A partial supply update was recorded.'
          WHEN 'Completed' THEN 'Your demand supply is complete.'
          WHEN 'Manual Review' THEN 'Your demand is under verification.'
          ELSE 'Demand was created.' END
      FROM odr_matured_matches m JOIN freight_movements f ON f.id=m.odr_id
      WHERE m.status IN ('Pending','Matched','Partial','Completed','Manual Review')
      ON CONFLICT (odr_id, event_type, status_version) DO NOTHING
    `);
    await client.query("COMMIT");

    notificationEvents = results
      .filter((item) => ["Matched", "Partial", "Completed", "Manual Review"].includes(item.status) && item.odr_id)
      .map((item) => ({ item, odr: odrById.get(item.odr_id) }));
    const summary = {
      total_odr: odrs.length,
      total_matured: matured.length,
      matched: results.filter((item) => item.odr_id && item.status === "Matched").length,
      completed: results.filter((item) => item.odr_id && item.status === "Completed").length,
      partial: results.filter((item) => item.odr_id && item.status === "Partial").length,
      pending: results.filter((item) => item.odr_id && item.status === "Pending").length,
      duplicates: results.filter((item) => item.status === "Duplicate").length,
      manual_review: results.filter((item) => item.odr_id && item.status === "Manual Review").length,
      unmatched_matured: results.filter((item) => !item.odr_id && item.status === "Unmatched").length,
      elapsed_ms: Date.now() - startedAt,
      run_id: runId,
      rule_version: rules.version,
    };
    await pool.query(
      `UPDATE matching_runs SET completed_at=NOW(), odr_scanned=$2, matured_scanned=$3,
       matched=$4, pending=$5, partial=$6, ambiguous=$7, duplicate_count=$8,
       duration_ms=$9, status='Completed' WHERE run_id=$1`,
      [runId, odrs.length, matured.length, summary.matched + summary.completed, summary.pending,
       summary.partial, summary.manual_review, summary.duplicates, summary.elapsed_ms]
    );
    console.info("[Matching] Matching Completed", summary);

    for (let start = 0; emitNotifications && start < notificationEvents.length; start += 10) {
      await Promise.all(notificationEvents.slice(start, start + 10).map(async ({ item, odr }) => {
        const isManual = item.status === "Manual Review";
        await createNotification({
          movement_reference: `MATCH:${item.odr_id}:${item.matured_id || "REVIEW"}`,
          station_code: odr?.station_from || null,
          notification_type: isManual ? "ManualReviewRequired" : item.status === "Partial" ? "PartialSupplyUpdated" : item.status === "Completed" ? "DemandCompleted" : "DemandMatured",
          type: isManual
            ? "AdminReview"
            : ["Inward", "Outward"].includes(odr?.raw?.movement_type)
              ? odr.raw.movement_type
              : "Inward",
          title: isManual ? "Manual Review Required" : item.status === "Partial" ? "Partial Supply Updated" : item.status === "Completed" ? "Demand Completed" : "Demand Matured",
          message: isManual ? `ODR ${odr?.raw?.odr_number || ""} has an ambiguous match.` : item.status === "Completed" ? `Demand ${odr?.raw?.odr_number || ""} supply is complete.` : `ODR ${odr?.raw?.odr_number || ""} matched successfully.`,
          related_odr: odr?.raw?.odr_number || null,
          related_division: odr?.raw?.division || null,
          batch_id: odr?.batch || null,
          data: { admin_only: isManual, match_id: item.match_id },
        }).catch((error) => console.error("[Matching] notification failed", error?.message));
      }));
    }
    return summary;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await pool.query(
      "UPDATE matching_runs SET completed_at=NOW(), duration_ms=$2, status='Failed', error_message=$3 WHERE run_id=$1",
      [runId, Date.now() - startedAt, String(error?.message || error)]
    ).catch(() => undefined);
    console.error("[Matching] failed", { trigger, error: error?.message });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function getMatchingSummary() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await ensureMatchingSchema(pool);
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM freight_movements) AS total_odr,
        (SELECT COUNT(*)::int FROM matured_indents) AS total_matured,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Matched')::int AS matched,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Pending')::int AS pending,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Partial')::int AS partial,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'Duplicate')::int AS duplicate,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Duplicate')::int AS duplicate_odr,
        COUNT(*) FILTER (WHERE odr_id IS NULL AND status = 'Duplicate')::int AS duplicate_matured,
        COUNT(*) FILTER (WHERE odr_id IS NOT NULL AND status = 'Manual Review')::int AS manual_review,
        COUNT(*) FILTER (WHERE odr_id IS NULL AND status = 'Unmatched')::int AS unmatched_matured,
        (SELECT started_at FROM matching_runs WHERE status='Completed' ORDER BY started_at DESC LIMIT 1) AS last_matching_run,
        (SELECT duration_ms FROM matching_runs WHERE status='Completed' ORDER BY started_at DESC LIMIT 1) AS matching_duration
      FROM odr_matured_matches
    `);
    return result.rows[0];
  } finally {
    await pool.end();
  }
}

export async function listMatchingResults({ page = 1, limit = 50, status = "", search = "" } = {}) {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await ensureMatchingSchema(pool);
    const params = [];
    const where = ["m.odr_id IS NOT NULL"];
    if (status) { params.push(status); where.push(`m.status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(fm.data->>'odr_number' ILIKE $${params.length} OR fm.data->>'station_from' ILIKE $${params.length} OR fm.data->>'station_to' ILIKE $${params.length} OR fm.data->>'company' ILIKE $${params.length})`);
    }
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM odr_matured_matches m LEFT JOIN freight_movements fm ON fm.id=m.odr_id WHERE ${where.join(" AND ")}`,
      params
    );
    const offset = (Math.max(Number(page), 1) - 1) * Math.min(Math.max(Number(limit), 1), 200);
    const safeLimit = Math.min(Math.max(Number(limit), 1), 200);
    params.push(safeLimit, offset);
    const rows = await pool.query(`
      SELECT m.*, fm.data AS odr, mi.data AS matured
      FROM odr_matured_matches m
      LEFT JOIN freight_movements fm ON fm.id=m.odr_id
      LEFT JOIN matured_indents mi ON mi.id=m.matured_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.created_at DESC, m.match_id
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { items: rows.rows, total: count.rows[0].total, page: Math.max(Number(page), 1), limit: safeLimit };
  } finally {
    await pool.end();
  }
}

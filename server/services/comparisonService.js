import { Pool } from "pg";
import { DEFAULT_RULES, ensureMatchingSchema, runMatchingEngine } from "./matchingEngine.js";
import { lifecycleUnits, matchedLifecycleStatus, toUserStatus } from "./lifecycleStatus.js";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db";
const poolFor = () => new Pool({ connectionString: DATABASE_URL });

function addFilter(where, params, value, sql) {
  if (value === undefined || value === null || value === "") return;
  params.push(value);
  where.push(sql.replaceAll("$VALUE", `$${params.length}`));
}

function comparisonWhere(filters = {}) {
  const where = [];
  const params = [];
  addFilter(where, params, filters.status, "m.status = $VALUE");
  addFilter(where, params, filters.division, "fm.data->>'division' = $VALUE");
  addFilter(where, params, filters.state, "sm.state = $VALUE");
  addFilter(where, params, filters.district, "sm.district = $VALUE");
  addFilter(where, params, filters.station_from, "fm.data->>'station_from' = $VALUE");
  addFilter(where, params, filters.station_to, "fm.data->>'station_to' = $VALUE");
  addFilter(where, params, filters.company, "COALESCE(fm.data->>'company',fm.data->>'company_code') = $VALUE");
  addFilter(where, params, filters.cnsg, "fm.data->'raw_data'->>'cnsg' = $VALUE");
  addFilter(where, params, filters.commodity, "COALESCE(fm.data->>'commodity',fm.data->>'commodity_code') = $VALUE");
  addFilter(where, params, filters.rake_cmdt, "COALESCE(fm.data->>'rake_cmdt',fm.data->>'rake_commodity_code') = $VALUE");
  addFilter(where, params, filters.batch_odr, "m.batch_odr = $VALUE");
  addFilter(where, params, filters.batch_matured, "m.batch_matured = $VALUE");
  addFilter(where, params, filters.match_method, "m.match_method = $VALUE");
  const minimumConfidence = filters.confidence_min ?? filters.min_confidence;
  if (minimumConfidence !== "" && minimumConfidence != null) addFilter(where, params, Number(minimumConfidence), "m.confidence >= $VALUE");
  if (filters.confidence_max !== "" && filters.confidence_max != null) addFilter(where, params, Number(filters.confidence_max), "m.confidence <= $VALUE");
  addFilter(where, params, filters.upload_from, "fm.created_date >= $VALUE::date");
  addFilter(where, params, filters.upload_to, "fm.created_date < ($VALUE::date + INTERVAL '1 day')");
  if (String(filters.data_quality || "") === "1") {
    where.push(`(COALESCE(fm.data->>'division','')='' OR COALESCE(fm.data->>'station_from','')=''
      OR COALESCE(fm.data->>'station_to','')='' OR COALESCE(fm.data->>'company','')=''
      OR COALESCE(fm.data->>'commodity','')='' OR COALESCE(fm.data->>'departure_date','')=''
      OR COALESCE(m.batch_odr,'')='')`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const p = `$${params.length}`;
    where.push(`(fm.data->>'odr_number' ILIKE ${p} OR mi.data->>'indent_number' ILIKE ${p}
      OR fm.data->>'station_from' ILIKE ${p} OR fm.data->>'station_to' ILIKE ${p}
      OR fm.data->>'company' ILIKE ${p})`);
  }
  return { where, params };
}

const BASE_FROM = `
  FROM odr_matured_matches m
  LEFT JOIN freight_movements fm ON fm.id=m.odr_id
  LEFT JOIN matured_indents mi ON mi.id=m.matured_id
  LEFT JOIN station_master sm ON sm.station_code=fm.data->>'station_from'
`;

function mapComparison(row) {
  const units = lifecycleUnits(row.odr || {}, row.matured || {});
  const checks = {
    division: row.odr?.division, station: row.odr?.station_from,
    destination: row.odr?.station_to, company: row.odr?.company || row.odr?.company_code,
    commodity: row.odr?.commodity, date: row.odr?.departure_date, batch_id: row.batch_odr,
  };
  const data_quality_issues = Object.entries(checks).filter(([, value]) => !value).map(([key]) => `Missing ${key}`);
  if (!units.indented_units) data_quality_issues.push("Missing or zero indented units");
  if (units.over_supplied) data_quality_issues.push("Supplied units exceed indented units");
  return { ...row, ...units, data_quality_issues };
}

export async function comparisonRecords(filters = {}, { page = 1, limit = 50, includeMaturedOnly = true, maxLimit = 500 } = {}) {
  const pool = poolFor();
  try {
    await ensureMatchingSchema(pool);
    const { where, params } = comparisonWhere(filters);
    if (!includeMaturedOnly) where.push("m.odr_id IS NOT NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await pool.query(`SELECT COUNT(*)::int total ${BASE_FROM} ${clause}`, params);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), maxLimit);
    const safePage = Math.max(Number(page) || 1, 1);
    const sortColumns = {
      odr_number: "fm.data->>'odr_number'", division: "fm.data->>'division'",
      station_from: "fm.data->>'station_from'", destination: "fm.data->>'station_to'",
      company: "fm.data->>'company'", commodity: "fm.data->>'commodity'",
      status: "m.status", confidence: "m.confidence", matched_on: "m.matched_on",
      demand_date: "fm.data->>'departure_date'",
    };
    const sortColumn = sortColumns[filters.sort_by] || "COALESCE(m.matched_on, fm.created_date, mi.created_date)";
    const sortDirection = String(filters.sort_order || filters.order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const rows = await pool.query(`
      SELECT m.*, fm.data odr, mi.data matured, fm.created_date odr_uploaded_at,
        mi.created_date matured_uploaded_at, sm.state source_state, sm.district source_district
      ${BASE_FROM} ${clause}
      ORDER BY ${sortColumn} ${sortDirection} NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.rows.map(mapComparison), total: count.rows[0].total, page: safePage, limit: safeLimit };
  } finally { await pool.end(); }
}

export async function comparisonFilterOptions({ state = "" } = {}) {
  const pool = poolFor();
  try {
    const [result, statesResult, districtsResult] = await Promise.all([
      pool.query(`
      SELECT
       ARRAY(SELECT DISTINCT data->>'division' FROM freight_movements WHERE COALESCE(data->>'division','')<>'' ORDER BY 1) divisions,
       ARRAY(SELECT DISTINCT data->>'station_from' FROM freight_movements WHERE COALESCE(data->>'station_from','')<>'' ORDER BY 1) stations_from,
       ARRAY(SELECT DISTINCT data->>'station_to' FROM freight_movements WHERE COALESCE(data->>'station_to','')<>'' ORDER BY 1) destinations,
       ARRAY(SELECT DISTINCT COALESCE(data->>'company',data->>'company_code') FROM freight_movements WHERE COALESCE(data->>'company',data->>'company_code','')<>'' ORDER BY 1) companies,
       ARRAY(SELECT DISTINCT data->'raw_data'->>'cnsg' FROM freight_movements WHERE COALESCE(data->'raw_data'->>'cnsg','')<>'' ORDER BY 1) cnsgs,
       ARRAY(SELECT DISTINCT COALESCE(data->>'commodity',data->>'commodity_code') FROM freight_movements WHERE COALESCE(data->>'commodity',data->>'commodity_code','')<>'' ORDER BY 1) commodities,
       ARRAY(SELECT DISTINCT COALESCE(data->>'rake_cmdt',data->>'rake_commodity_code') FROM freight_movements WHERE COALESCE(data->>'rake_cmdt',data->>'rake_commodity_code','')<>'' ORDER BY 1) rake_cmdts,
       ARRAY(SELECT DISTINCT match_method FROM odr_matured_matches ORDER BY 1) match_methods,
       ARRAY(SELECT DISTINCT data->>'batch_id' FROM upload_logs WHERE data->>'file_type'='ODR' AND COALESCE(data->>'batch_id','')<>'' ORDER BY 1) odr_batches,
       ARRAY(SELECT DISTINCT data->>'batch_id' FROM upload_logs WHERE data->>'file_type'='MaturedIndent' AND COALESCE(data->>'batch_id','')<>'' ORDER BY 1) matured_batches
    `),
      pool.query(`
        SELECT code value, COALESCE(NULLIF(name,''), code) label
        FROM state_master WHERE active IS DISTINCT FROM FALSE ORDER BY label
      `).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT code value, COALESCE(NULLIF(name,''), code) label,
               COALESCE(parent_code, '') state
        FROM district_master
        WHERE ($1='' OR COALESCE(parent_code, '')=$1)
          AND active IS DISTINCT FROM FALSE ORDER BY label
      `, [state]).catch(() => ({ rows: [] })),
    ]);
    return {
      ...result.rows[0],
      states: statesResult.rows,
      districts: districtsResult.rows,
      divisions_options: (result.rows[0].divisions || []).map((value) => ({ value, label: value })),
      stations_from_options: (result.rows[0].stations_from || []).map((value) => ({ value, label: value })),
      destinations_options: (result.rows[0].destinations || []).map((value) => ({ value, label: value })),
      companies_options: (result.rows[0].companies || []).map((value) => ({ value, label: value })),
      commodities_options: (result.rows[0].commodities || []).map((value) => ({ value, label: value })),
      rake_cmdts_options: (result.rows[0].rake_cmdts || []).map((value) => ({ value, label: value })),
    };
  } finally { await pool.end(); }
}

function addMetric(map, key, units) {
  const label = key || "Unknown";
  const item = map.get(label) || { name: label, demand: 0, supply: 0, pending: 0, count: 0 };
  item.demand += units.indented_units; item.supply += units.supplied_units;
  item.pending += units.balance_units; item.count += 1; map.set(label, item);
}

export async function comparisonAnalytics(filters = {}, auth = null) {
  const pool = poolFor();
  try {
    const { where, params } = comparisonWhere(filters);
    where.push("m.odr_id IS NOT NULL", "m.status NOT IN ('Duplicate','Unmatched')");
    if (auth) permissionClause(auth, where, params);
    const result = await pool.query(`
      SELECT m.status, m.confidence, fm.data odr, mi.data matured
      ${BASE_FROM} WHERE ${where.join(" AND ")}`, params);
    const division = new Map(), station = new Map(), commodity = new Map(), company = new Map(), month = new Map();
    const statuses = new Map(), confidence = new Map(), aging = new Map([
      ["0–1 day", { name: "0–1 day", count: 0, units: 0 }],
      ["2–3 days", { name: "2–3 days", count: 0, units: 0 }],
      ["4–7 days", { name: "4–7 days", count: 0, units: 0 }],
      ["8–15 days", { name: "8–15 days", count: 0, units: 0 }],
      ["15+ days", { name: "15+ days", count: 0, units: 0 }],
    ]);
    let oldest = 0, ageTotal = 0, pendingCount = 0;
    for (const row of result.rows) {
      const units = lifecycleUnits(row.odr, row.matured);
      addMetric(division, row.odr?.division, units); addMetric(station, row.odr?.station_from, units);
      addMetric(commodity, row.odr?.commodity, units); addMetric(company, row.odr?.company || row.odr?.company_code, units);
      addMetric(month, String(row.odr?.departure_date || "").slice(0, 7), units);
      statuses.set(row.status, (statuses.get(row.status) || 0) + 1);
      const band = Number(row.confidence) >= 95 ? "95–100%" : Number(row.confidence) >= 80 ? "80–94%" : "Below 80%";
      confidence.set(band, (confidence.get(band) || 0) + 1);
      if (row.status === "Pending") {
        const demand = Date.parse(`${row.odr?.departure_date || ""}T00:00:00Z`);
        if (Number.isFinite(demand)) {
          const days = Math.max(Math.floor((Date.now() - demand) / 86400000), 0);
          const bucket = days <= 1 ? "0–1 day" : days <= 3 ? "2–3 days" : days <= 7 ? "4–7 days" : days <= 15 ? "8–15 days" : "15+ days";
          const item = aging.get(bucket); item.count++; item.units += units.balance_units;
          oldest = Math.max(oldest, days); ageTotal += days; pendingCount++;
        }
      }
    }
    const top = (map, size = 20) => [...map.values()].sort((a, b) => b.demand - a.demand).slice(0, size);
    return {
      by_division: top(division), by_station: top(station), by_commodity: top(commodity),
      pending_by_company: [...company.values()].sort((a,b)=>b.pending-a.pending).slice(0,20),
      monthly_fulfilment: [...month.values()].sort((a,b)=>a.name.localeCompare(b.name)),
      status_distribution: [...statuses].map(([name, value]) => ({ name, value })),
      confidence_distribution: [...confidence].map(([name, value]) => ({ name, value })),
      aging: [...aging.values()], oldest_pending_days: oldest,
      average_pending_age: pendingCount ? ageTotal / pendingCount : 0,
    };
  } finally { await pool.end(); }
}

export async function comparisonDetail(matchId) {
  const pool = poolFor();
  try {
    const result = await pool.query(`
      SELECT m.*, fm.data odr, mi.data matured FROM odr_matured_matches m
      LEFT JOIN freight_movements fm ON fm.id=m.odr_id
      LEFT JOIN matured_indents mi ON mi.id=m.matured_id WHERE m.match_id=$1`, [matchId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const candidates = row.odr_id ? await pool.query(`
      SELECT mi.id, mi.data,
        (CASE WHEN UPPER(COALESCE(mi.data->>'commodity',''))=UPPER(COALESCE($1,'')) THEN 20 ELSE 0 END
         + CASE WHEN COALESCE(mi.data->>'indent_date','')=COALESCE($2,'') THEN 10 ELSE 0 END) score
      FROM matured_indents mi
      WHERE UPPER(COALESCE(mi.data->>'indent_number',''))=UPPER(COALESCE($3,''))
        AND UPPER(COALESCE(mi.data->>'division',''))=UPPER(COALESCE($4,''))
        AND UPPER(COALESCE(mi.data->>'station_from',''))=UPPER(COALESCE($5,''))
        AND UPPER(COALESCE(mi.data->>'station_to',''))=UPPER(COALESCE($6,''))
      ORDER BY score DESC LIMIT 100`, [
        row.odr?.commodity, row.odr?.departure_date, row.odr?.odr_number,
        row.odr?.division, row.odr?.station_from, row.odr?.station_to,
      ]) : { rows: [] };
    return { ...mapComparison(row), candidates: candidates.rows };
  } finally { await pool.end(); }
}

export async function resolveComparison(matchId, { matured_id, note = "", resolvedBy }) {
  const pool = poolFor();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM odr_matured_matches WHERE match_id=$1 FOR UPDATE", [matchId]);
    const match = current.rows[0];
    if (!match?.odr_id) throw Object.assign(new Error("ODR match record not found"), { status: 404 });
    const records = await client.query(
      `SELECT (SELECT data FROM freight_movements WHERE id=$1) odr,
              (SELECT data FROM matured_indents WHERE id=$2) matured`, [match.odr_id, matured_id]);
    if (!records.rows[0]?.matured) throw Object.assign(new Error("Matured record not found"), { status: 404 });
    const occupied = await client.query(
      "SELECT 1 FROM odr_matured_matches WHERE matured_id=$1 AND odr_id<>$2 AND status IN ('Matched','Partial','Completed') LIMIT 1",
      [matured_id, match.odr_id]);
    if (occupied.rowCount) throw Object.assign(new Error("Matured record is already assigned"), { status: 409 });
    const status = matchedLifecycleStatus(records.rows[0].odr, records.rows[0].matured, "Matched");
    await client.query("DELETE FROM odr_matured_matches WHERE matured_id=$1 AND odr_id IS NULL", [matured_id]);
    await client.query(`
      UPDATE odr_matured_matches SET matured_id=$2, status=$3, confidence=100,
       match_method='Manual Resolution', reason='Admin confirmed match', matched_on=NOW(),
       matched_by=$4, batch_matured=COALESCE($5,''), manual_locked=TRUE, manual_match=TRUE,
       resolved_by=$4, resolved_at=NOW(), resolution_note=$6, previous_status=status,
       match_rule_version=(SELECT version FROM matching_rule_config WHERE id='active')
      WHERE match_id=$1`, [matchId, matured_id, status, resolvedBy,
        records.rows[0].matured.upload_batch_id || records.rows[0].matured.batch_id, note]);
    await client.query("COMMIT");
    await runMatchingEngine({ requestedBy: resolvedBy, trigger: "manual-resolution", scope: { type: "record", odr_id: match.odr_id } });
    return comparisonDetail(matchId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); await pool.end(); }
}

export async function unmatchComparison(matchId, { note = "", resolvedBy }) {
  const pool = poolFor();
  try {
    const result = await pool.query(`
      UPDATE odr_matured_matches SET previous_status=status, matured_id=NULL, status='Pending',
       confidence=0, match_method='Manual No Match', reason='Admin marked no match',
       matched_on=NULL, matched_by=$2, batch_matured=NULL, manual_locked=TRUE, manual_match=TRUE,
       resolved_by=$2, resolved_at=NOW(), resolution_note=$3
      WHERE match_id=$1 AND odr_id IS NOT NULL RETURNING odr_id`, [matchId, resolvedBy, note]);
    if (!result.rowCount) throw Object.assign(new Error("Comparison record not found"), { status: 404 });
    await runMatchingEngine({ requestedBy: resolvedBy, trigger: "manual-unmatch", scope: { type: "record", odr_id: result.rows[0].odr_id } });
    return comparisonDetail(matchId);
  } finally { await pool.end(); }
}

export async function matchingRuns({ limit = 50 } = {}) {
  const pool = poolFor();
  try {
    const result = await pool.query("SELECT * FROM matching_runs ORDER BY started_at DESC LIMIT $1", [Math.min(Number(limit) || 50, 200)]);
    return result.rows;
  } finally { await pool.end(); }
}

export async function getRules() {
  const pool = poolFor();
  try {
    const result = await pool.query("SELECT version, config, updated_by, updated_at FROM matching_rule_config WHERE id='active'");
    return result.rows[0] || { version: DEFAULT_RULES.version, config: DEFAULT_RULES };
  } finally { await pool.end(); }
}

export async function saveRules(config, updatedBy) {
  const pool = poolFor();
  try {
    const version = String(config.version || `${Date.now()}`);
    const next = { ...DEFAULT_RULES, ...config, version };
    await pool.query(
      `INSERT INTO matching_rule_config (id,version,config,updated_by,updated_at)
       VALUES ('active',$1,$2::jsonb,$3,NOW()) ON CONFLICT(id) DO UPDATE
       SET version=EXCLUDED.version, config=EXCLUDED.config, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [version, JSON.stringify(next), updatedBy]);
    await runMatchingEngine({ requestedBy: updatedBy, trigger: "rule-change", scope: { type: "all" } });
    return getRules();
  } finally { await pool.end(); }
}

function permissionClause(auth, where, params) {
  const company = auth?.company_code || auth?.enterprise_code;
  if (company) addFilter(where, params, company, "COALESCE(fm.data->>'company',fm.data->>'company_code') = $VALUE");
}

export async function userFreightRecords(auth, filters = {}, { page = 1, limit = 50, maxLimit = 200 } = {}) {
  const { where, params } = comparisonWhere(filters);
  where.push("m.odr_id IS NOT NULL", "m.status NOT IN ('Duplicate','Unmatched')");
  permissionClause(auth, where, params);
  const pool = poolFor();
  try {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), maxLimit);
    const safePage = Math.max(Number(page) || 1, 1);
    const count = await pool.query(`SELECT COUNT(*)::int total ${BASE_FROM} WHERE ${where.join(" AND ")}`, params);
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const result = await pool.query(`
      SELECT m.match_id id, m.status, m.matched_on, fm.updated_date, fm.data odr, mi.data matured
      ${BASE_FROM} WHERE ${where.join(" AND ")}
      ORDER BY fm.created_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return {
      items: result.rows.map((row) => {
        const units = lifecycleUnits(row.odr, row.matured);
        return { ...row, status: toUserStatus(row.status), ...units };
      }), total: count.rows[0].total, page: safePage, limit: safeLimit,
    };
  } finally { await pool.end(); }
}

export async function userFreightSummary(auth, filters = {}) {
  const pool = poolFor();
  try {
    const { where, params } = comparisonWhere(filters);
    where.push("m.odr_id IS NOT NULL", "m.status NOT IN ('Duplicate','Unmatched')");
    permissionClause(auth, where, params);
    const result = await pool.query(`
      SELECT m.status, fm.data odr, mi.data matured ${BASE_FROM}
      WHERE ${where.join(" AND ")}`, params);
    const summary = { total_demands: result.rowCount, pending: 0, matured: 0, partial: 0, completed: 0, total_indented_units: 0, total_supplied_units: 0, balance_units: 0, over_supplied_issues: 0 };
    for (const row of result.rows) {
      const status = toUserStatus(row.status);
      if (status === "Pending") summary.pending++;
      else if (status === "Matured") summary.matured++;
      else if (status === "Partially Supplied") summary.partial++;
      else if (status === "Completed") summary.completed++;
      const units = lifecycleUnits(row.odr, row.matured);
      summary.total_indented_units += units.indented_units;
      summary.total_supplied_units += units.supplied_units;
      summary.balance_units += units.balance_units;
      if (units.over_supplied) summary.over_supplied_issues++;
    }
    summary.fulfilment_percentage = summary.total_indented_units
      ? Math.min((summary.total_supplied_units / summary.total_indented_units) * 100, 100)
      : 0;
    return summary;
  } finally { await pool.end(); }
}

export async function userTimeline(auth, matchId) {
  const pool = poolFor();
  try {
    const allowed = await pool.query(`
      SELECT m.odr_id, fm.data FROM odr_matured_matches m
      JOIN freight_movements fm ON fm.id=m.odr_id
      WHERE m.match_id=$1 AND m.status NOT IN ('Duplicate','Unmatched')`, [matchId]);
    if (!allowed.rowCount) return null;
    const company = auth?.company_code || auth?.enterprise_code;
    if (company && ![allowed.rows[0].data.company, allowed.rows[0].data.company_code].includes(company)) return null;
    const events = await pool.query(
      "SELECT event_type, units, batch_reference, message, created_at FROM freight_lifecycle_events WHERE odr_id=$1 ORDER BY created_at",
      [allowed.rows[0].odr_id]);
    return { demand_no: allowed.rows[0].data.odr_number, events: events.rows };
  } finally { await pool.end(); }
}

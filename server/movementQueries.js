import { Pool } from "pg";
import { cachedJson } from "./cache.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db" });

const fieldSql = {
  // Uploaded files carry no real zone column; zone is derived live from the
  // division via division_master.parent_code (the zone -> division hierarchy
  // already established in master data), never from the stored data.
  zone: "(SELECT dm.parent_code FROM division_master dm WHERE dm.code = data->>'division')",
  division: "data->>'division'",
  stateInward: "COALESCE(to_state, data->>'to_state')",
  stateOutward: "COALESCE(from_state, data->>'from_state')",
  districtInward: "COALESCE(to_district, data->>'to_district')",
  districtOutward: "COALESCE(from_district, data->>'from_district')",
  stationInward: "COALESCE(station_to, data->>'station_to')",
  stationOutward: "COALESCE(station_from, data->>'station_from')",
  commodity: "COALESCE(commodity_name, commodity_code, data->>'commodity_name', data->>'commodity_code', data->>'commodity')",
  rake: "COALESCE(rake_commodity_code, data->>'rake_commodity_code', data->>'rake_cmdt')",
  company: "COALESCE(data->>'company', data->>'consignor', data->>'consignee')",
  status: "data->>'status'",
};

function queryContext(input = {}) {
  const direction = input.direction === "Outward" ? "Outward" : "Inward";
  const inward = direction === "Inward";
  const expressions = {
    state: fieldSql[inward ? "stateInward" : "stateOutward"],
    district: fieldSql[inward ? "districtInward" : "districtOutward"],
    station: fieldSql[inward ? "stationInward" : "stationOutward"],
    zone: fieldSql.zone, division: fieldSql.division, commodity: fieldSql.commodity,
    rake: fieldSql.rake, company: fieldSql.company,
  };
  const params = [direction];
  const where = ["data->>'movement_type' = $1"];
  for (const key of Object.keys(expressions)) {
    const values = Array.isArray(input[key]) ? input[key].filter(Boolean) : [];
    if (!values.length) continue;
    params.push(values);
    where.push(`${expressions[key]} = ANY($${params.length}::text[])`);
  }
  return { direction, inward, expressions, params, where: where.join(" AND ") };
}

async function group(where, params, expression, limit) {
  const result = await pool.query(
    `SELECT COALESCE(${expression}, 'Unknown') AS name, COUNT(*)::int AS count
     FROM freight_movements WHERE ${where}
     GROUP BY 1 ORDER BY count DESC LIMIT ${Number(limit)}`,
    params
  );
  return result.rows;
}

export async function movementDashboardSummary(input) {
  const ctx = queryContext(input);
  const cacheKey = `movement:dashboard:v1:${JSON.stringify(input)}`;
  return cachedJson(cacheKey, Number(process.env.DASHBOARD_CACHE_TTL_SECONDS || 120), async () => {
    const trendExpression = ctx.inward
      ? "COALESCE(NULLIF(arrival_date, ''), data->>'arrival_date')"
      : "COALESCE(NULLIF(departure_date, ''), data->>'departure_date')";
    const [totals, commodityData, divisionData, stationData, trend, ...facets] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ${fieldSql.status} IN ('Pending','In Transit'))::int AS pending,
          COUNT(*) FILTER (WHERE ${fieldSql.status} = 'Arrived')::int AS arrived,
          COUNT(*) FILTER (WHERE ${fieldSql.status} = 'Departed')::int AS departed,
          COUNT(*) FILTER (WHERE ${fieldSql.status} = 'Delayed')::int AS delayed
         FROM freight_movements WHERE ${ctx.where}`,
        ctx.params
      ),
      group(ctx.where, ctx.params, ctx.expressions.commodity, 10),
      group(ctx.where, ctx.params, ctx.expressions.division, 8),
      group(ctx.where, ctx.params, ctx.expressions.station, 10),
      pool.query(
        `SELECT LEFT(${trendExpression}, 10) AS name, COUNT(*)::int AS count
         FROM freight_movements WHERE ${ctx.where} AND ${trendExpression} IS NOT NULL
         GROUP BY 1 ORDER BY name DESC LIMIT 12`, ctx.params
      ),
      ...Object.values(ctx.expressions).map((expression) =>
        pool.query(`SELECT DISTINCT ${expression} AS value FROM freight_movements WHERE ${ctx.where} AND ${expression} IS NOT NULL ORDER BY value LIMIT 2000`, ctx.params)
      ),
    ]);
    const facetKeys = Object.keys(ctx.expressions);
    const options = Object.fromEntries(facetKeys.map((key, index) => [key, facets[index].rows.map((row) => row.value)]));
    return { ...totals.rows[0], commodityData, divisionData, stationData, trendData: trend.rows.reverse(), options };
  });
}

export async function pagedMovements(input) {
  const ctx = queryContext(input);
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 200);
  const page = Math.max(Number(input.page) || 1, 1);
  const params = [...ctx.params];
  let where = ctx.where;
  const search = String(input.search || "").trim();
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (data->>'odr_number' ILIKE $${params.length} OR data->>'company' ILIKE $${params.length} OR station_from ILIKE $${params.length} OR station_to ILIKE $${params.length})`;
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM freight_movements WHERE ${where}`, params);
  params.push(limit, (page - 1) * limit);
  const rows = await pool.query(
    `SELECT freight_movements.*,
       COALESCE(sm_from.station_name, freight_movements.from_station_name) AS from_station_name,
       COALESCE(sm_from.district, freight_movements.from_district) AS from_district,
       COALESCE(sm_from.state, freight_movements.from_state) AS from_state,
       COALESCE(sm_from.zone, freight_movements.from_zone) AS from_zone,
       COALESCE(sm_from.division, freight_movements.from_division) AS from_division,
       COALESCE(sm_to.station_name, freight_movements.to_station_name) AS to_station_name,
       COALESCE(sm_to.district, freight_movements.to_district) AS to_district,
       COALESCE(sm_to.state, freight_movements.to_state) AS to_state,
       COALESCE(sm_to.zone, freight_movements.to_zone) AS to_zone,
       COALESCE(sm_to.division, freight_movements.to_division) AS to_division
     FROM freight_movements
     LEFT JOIN station_master sm_from ON sm_from.station_code = freight_movements.station_from AND sm_from.is_active IS DISTINCT FROM FALSE
     LEFT JOIN station_master sm_to ON sm_to.station_code = freight_movements.station_to AND sm_to.is_active IS DISTINCT FROM FALSE
     WHERE ${where} ORDER BY freight_movements.created_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: rows.rows.map((row) => ({ ...(row.data || {}), ...row, data: undefined })),
    total: count.rows[0].total, page, limit, totalPages: Math.max(1, Math.ceil(count.rows[0].total / limit)),
  };
}

const reportExpressions = {
  division: "COALESCE(data->>'division', data->'raw_data'->>'DVSN')",
  stationFrom: "COALESCE(station_from, data->>'station_from', data->'raw_data'->>'STTN FROM')",
  commodity: "COALESCE(commodity_code, data->>'commodity_code', data->>'commodity', data->'raw_data'->>'CMDT')",
  destination: "COALESCE(station_to, data->>'station_to', data->'raw_data'->>'DSTN')",
};

function addArrayFilter(where, params, expression, values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return;
  params.push(items);
  where.push(`${expression} = ANY($${params.length}::text[])`);
}

export async function pagedFoisReports(input = {}) {
  const page = Math.max(Number(input.page) || 1, 1);
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const params = [];
  const where = [];
  addArrayFilter(where, params, reportExpressions.division, input.division);
  addArrayFilter(where, params, reportExpressions.stationFrom, input.stationFrom);
  addArrayFilter(where, params, reportExpressions.commodity, input.commodity);
  addArrayFilter(where, params, reportExpressions.destination, input.destination);

  const search = String(input.search || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const token = `$${params.length}`;
    where.push(`(
      data->>'odr_number' ILIKE ${token} OR data->>'indent_no' ILIKE ${token}
      OR data->>'company' ILIKE ${token} OR data->>'cnsr' ILIKE ${token} OR data->>'cnsg' ILIKE ${token}
      OR ${reportExpressions.division} ILIKE ${token} OR ${reportExpressions.stationFrom} ILIKE ${token}
      OR ${reportExpressions.commodity} ILIKE ${token} OR ${reportExpressions.destination} ILIKE ${token}
    )`);
  }
  if (input.unmappedOnly) {
    where.push(`(
      (station_from IS NOT NULL AND station_from <> '' AND NOT EXISTS (
        SELECT 1 FROM station_master sm WHERE sm.station_code = station_from AND sm.is_active IS DISTINCT FROM FALSE
      ))
      OR (station_to IS NOT NULL AND station_to <> '' AND NOT EXISTS (
        SELECT 1 FROM station_master sm WHERE sm.station_code = station_to AND sm.is_active IS DISTINCT FROM FALSE
      ))
    )`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const metadataKey = `movement:reports:metadata:v2:${JSON.stringify({ search, division: input.division, stationFrom: input.stationFrom, commodity: input.commodity, destination: input.destination, unmappedOnly: input.unmappedOnly })}`;
  const metadata = await cachedJson(metadataKey, 120, async () => {
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM freight_movements${whereSql}`, params);
    const facets = await Promise.all(Object.values(reportExpressions).map((expression) =>
      pool.query(`SELECT DISTINCT ${expression} AS value FROM freight_movements WHERE ${expression} IS NOT NULL AND ${expression} <> '' ORDER BY value LIMIT 5000`)
    ));
    const keys = Object.keys(reportExpressions);
    return {
      total: count.rows[0].total,
      options: Object.fromEntries(keys.map((key, index) => [key, facets[index].rows.map((row) => row.value)])),
    };
  });
  const cacheKey = `movement:reports:page:v2:${JSON.stringify(input)}`;
  return cachedJson(cacheKey, 60, async () => {
    const rowParams = [...params, limit, (page - 1) * limit];
    const rows = await pool.query(
      `SELECT fm.*,
        (SELECT COALESCE(ul.data->>'uploaded_at', ul.data->>'upload_time', ul.created_date::text)
         FROM upload_logs ul
         WHERE ul.data->>'batch_id' = COALESCE(fm.data->>'upload_batch_id', fm.data->>'batch_id')
         ORDER BY ul.created_date DESC LIMIT 1) AS report_upload_date,
        COALESCE(sm_from.station_name, fm.from_station_name) AS from_station_name,
        COALESCE(sm_from.district, fm.from_district) AS from_district,
        COALESCE(sm_from.state, fm.from_state) AS from_state,
        COALESCE(sm_from.zone, fm.from_zone) AS from_zone,
        COALESCE(sm_from.division, fm.from_division) AS from_division,
        COALESCE(sm_to.station_name, fm.to_station_name) AS to_station_name,
        COALESCE(sm_to.district, fm.to_district) AS to_district,
        COALESCE(sm_to.state, fm.to_state) AS to_state,
        COALESCE(sm_to.zone, fm.to_zone) AS to_zone,
        COALESCE(sm_to.division, fm.to_division) AS to_division
       FROM freight_movements fm
       LEFT JOIN station_master sm_from ON sm_from.station_code = fm.station_from AND sm_from.is_active IS DISTINCT FROM FALSE
       LEFT JOIN station_master sm_to ON sm_to.station_code = fm.station_to AND sm_to.is_active IS DISTINCT FROM FALSE
       ${whereSql}
       ORDER BY fm.created_date DESC, fm.id DESC LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    );
    return {
      items: rows.rows.map((row) => ({ ...(row.data || {}), ...row, upload_date: row.report_upload_date, data: undefined, report_upload_date: undefined })),
      total: metadata.total, page, limit,
      totalPages: Math.max(1, Math.ceil(metadata.total / limit)),
      options: metadata.options,
    };
  });
}

export async function filterHierarchy(direction) {
  // Inward monitors filter stations by station_to (arrival point) and Outward
  // by station_from (departure point) — see fieldSql.stationInward/Outward
  // above — so the station list offered here must match the same side,
  // otherwise Inward and Outward show identical, direction-blind options.
  const stationCodeExpr =
    direction === "Inward"
      ? "SELECT DISTINCT station_to AS code FROM freight_movements WHERE station_to IS NOT NULL AND station_to <> ''"
      : direction === "Outward"
        ? "SELECT DISTINCT station_from AS code FROM freight_movements WHERE station_from IS NOT NULL AND station_from <> ''"
        : `SELECT station_from AS code FROM freight_movements WHERE station_from IS NOT NULL AND station_from <> ''
           UNION
           SELECT station_to AS code FROM freight_movements WHERE station_to IS NOT NULL AND station_to <> ''`;
  const cacheKey = `movement:filter-hierarchy:v5:${direction || "all"}`;
  return cachedJson(cacheKey, 300, async () => {
    const [states, districts, stations, pairs, masters, zones, divisions, rawStations] = await Promise.all([
      pool.query("SELECT code, name FROM state_master WHERE active IS DISTINCT FROM FALSE ORDER BY name, code"),
      pool.query("SELECT code, name, parent_code FROM district_master WHERE active IS DISTINCT FROM FALSE ORDER BY name, code"),
      pool.query("SELECT station_code AS code, station_name AS name, state, district, division FROM station_master WHERE is_active IS DISTINCT FROM FALSE ORDER BY station_name, station_code"),
      pool.query(`SELECT DISTINCT COALESCE(commodity_code, data->>'commodity_code', data->>'commodity') AS commodity,
        COALESCE(rake_commodity_code, data->>'rake_commodity_code', data->>'rake_cmdt') AS rake
        FROM freight_movements`),
      pool.query("SELECT code, name, type FROM commodity_master WHERE is_active IS DISTINCT FROM FALSE"),
      pool.query("SELECT code, name FROM zone_master WHERE active IS DISTINCT FROM FALSE ORDER BY name, code"),
      pool.query("SELECT code, name, parent_code FROM division_master WHERE active IS DISTINCT FROM FALSE ORDER BY name, code"),
      pool.query(`SELECT DISTINCT code FROM (${stationCodeExpr}) t`),
    ]);
    const labels = new Map(masters.rows.map((row) => [`${row.type}:${row.code}`, row.name]));
    const commodityCodes = [...new Set(pairs.rows.map((row) => row.commodity).filter(Boolean))].sort();
    const rakeMap = new Map();
    for (const row of pairs.rows) {
      if (!row.rake || /^(BOX|BOB|BOS|BCN|BTP|NMG)/i.test(row.rake) || /^\d+$/.test(row.rake)) continue;
      if (!rakeMap.has(row.rake)) rakeMap.set(row.rake, new Set());
      if (row.commodity) rakeMap.get(row.rake).add(row.commodity);
    }

    // Zone and division only ever come from their master tables — India has a
    // fixed, known set of each, so uploaded data never introduces a new one.
    // Unrecognized codes in uploads are surfaced separately (unmapped codes),
    // not blended into this list.
    const zonesOut = zones.rows.map((row) => ({ code: row.code, name: row.name, mapped: true }));

    const divisionsOut = divisions.rows.map((row) => ({
      code: row.code, name: row.name, parentCode: row.parent_code, mapped: true,
    }));

    const stationMasterSet = new Set(stations.rows.map((row) => row.code));
    const extraStationCodes = rawStations.rows.map((row) => row.code).filter((code) => code && !stationMasterSet.has(code));
    const stationsOut = [
      ...stations.rows.map((row) => ({ ...row, mapped: true })),
      ...extraStationCodes.map((code) => ({ code, name: code, state: null, district: null, division: null, mapped: false })),
    ];

    return {
      states: states.rows,
      districts: districts.rows.map((row) => ({ code: row.code, name: row.name, parentCode: row.parent_code })),
      stations: stationsOut,
      zones: zonesOut,
      divisions: divisionsOut,
      commodities: commodityCodes.map((code) => ({ code, name: labels.get(`Commodity:${code}`) || code, mapped: labels.has(`Commodity:${code}`) })),
      rakes: [...rakeMap].map(([code, commodities]) => ({ code, name: labels.get(`Rake CMDT:${code}`) || code, mapped: labels.has(`Rake CMDT:${code}`), commodities: [...commodities] })),
    };
  });
}

// Codes seen in uploaded data with no matching master record — surfaced to
// admins so they know exactly what to add next when building out the masters.
export async function unmappedSummary() {
  return cachedJson("movement:unmapped-summary:v1", 120, async () => {
    const [stations, commodities] = await Promise.all([
      pool.query(
        `SELECT station_code AS code, occurrence_count, first_seen_at, last_seen_at
         FROM unmapped_station_codes
         WHERE status = 'unmapped'
         ORDER BY occurrence_count DESC
         LIMIT 500`
      ),
      pool.query(
        `WITH codes AS (
           SELECT COALESCE(commodity_code, data->>'commodity_code', data->>'commodity') AS code
           FROM freight_movements
         )
         SELECT code, count(*)::int AS occurrence_count
         FROM codes
         WHERE code IS NOT NULL AND code <> ''
           AND NOT EXISTS (
             SELECT 1 FROM commodity_master cm
             WHERE cm.code = codes.code AND cm.type = 'Commodity' AND cm.is_active IS DISTINCT FROM FALSE
           )
         GROUP BY code
         ORDER BY occurrence_count DESC
         LIMIT 500`
      ),
    ]);
    return {
      stations: stations.rows,
      commodities: commodities.rows,
    };
  });
}

import "./loadEnv.js";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as XLSX from "xlsx";
import { runSeeder } from "../scripts/seedMasters.js";
import {
  countTables,
  createRecord,
  createRecords,
  createUser,
  deleteRecord,
  ensureSuperAdminExists,
  findUserById,
  findUserByIdentifier,
  getStorageStatus,
  initializeStorage,
  listUsers,
  listRecords,
  updateUserRole,
  updateRecord,
} from "./storage.js";

import { createNotification } from "./notifications/service.js";

import {
  createOrUpdateStation,
  deleteStationById,
  getStationById,
  listStations,
} from "./utils/mastersCrud.js";
import {
  bulkLookupStationMasters,
  upsertUnmappedStationCodes,
} from "./utils/stationMaster.js";
import {
  compareODRwithIndents,
  generateBatchId,
  getIndentRowRejectionReason,
  parseIndentRow,
  parseODRRow,
} from "../src/utils/odrcomparison.js";

// Import the new clean Phase-1 modular controller
import * as mastersController from "./controllers/mastersController.js";

function normalizeCommodityCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

async function bulkLookupCommodityMasters(codes) {
  const { Pool } = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://fois_user:fois_password@localhost:5432/fois_db";

  const pool = new Pool({ connectionString: databaseUrl });
  const unique = [
    ...new Set(codes.map(normalizeCommodityCode).filter(Boolean)),
  ];
  if (unique.length === 0) {
    await pool.end();
    return {};
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commodity_master (
      id TEXT PRIMARY KEY,
      commodity_code TEXT UNIQUE NOT NULL,
      commodity_name TEXT,
      commodity_group_code TEXT,
      commodity_group_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `SELECT commodity_code, commodity_name, commodity_group_name
     FROM commodity_master
     WHERE commodity_code = ANY($1::text[])`,
    [unique]
  );

  const map = {};
  for (const row of result.rows) {
    map[normalizeCommodityCode(row.commodity_code)] = {
      commodity_code: normalizeCommodityCode(row.commodity_code),
      commodity_name: row.commodity_name,
      commodity_group: row.commodity_group_name,
    };
  }

  await pool.end();
  return map;
}

async function bulkLookupRakeCommodityMasters(rakeCodes) {
  const { Pool } = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://fois_user:fois_password@localhost:5432/fois_db";

  const pool = new Pool({ connectionString: databaseUrl });
  const unique = [
    ...new Set(rakeCodes.map(normalizeCommodityCode).filter(Boolean)),
  ];
  if (unique.length === 0) {
    await pool.end();
    return {};
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rake_commodity_master (
      id TEXT PRIMARY KEY,
      rake_commodity_code TEXT UNIQUE NOT NULL,
      rake_commodity_name TEXT,
      commodity_group_code TEXT,
      commodity_group_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `SELECT rake_commodity_code, rake_commodity_name, commodity_group_name
     FROM rake_commodity_master
     WHERE rake_commodity_code = ANY($1::text[])`,
    [unique]
  );

  const map = {};
  for (const row of result.rows) {
    map[normalizeCommodityCode(row.rake_commodity_code)] = {
      rake_commodity_code: normalizeCommodityCode(row.rake_commodity_code),
      rake_commodity_name: row.rake_commodity_name,
      rake_commodity_group: row.commodity_group_name,
    };
  }

  await pool.end();
  return map;
}

async function enrichCommodityFields(records) {
  const rows = Array.isArray(records) ? records : [];
  const commodityCodes = rows
    .map((r) => normalizeCommodityCode(r.commodity))
    .filter(Boolean);
  const rakeCommodityCodes = rows
    .map((r) => normalizeCommodityCode(r.rake_type || r.rake_commodity_code))
    .filter(Boolean);

  const [commodityMap, rakeCommodityMap] = await Promise.all([
    bulkLookupCommodityMasters(commodityCodes),
    bulkLookupRakeCommodityMasters(rakeCommodityCodes),
  ]);

  return rows.map((r) => {
    const c = normalizeCommodityCode(r.commodity);
    const rake = normalizeCommodityCode(r.rake_type || r.rake_commodity_code);

    const commodityEnriched = c ? commodityMap[c] : null;
    const rakeEnriched = rake ? rakeCommodityMap[rake] : null;

    return {
      ...r,
      commodity_code: c || r.commodity_code,
      commodity_name: commodityEnriched?.commodity_name || null,
      commodity_group: commodityEnriched?.commodity_group || null,

      rake_commodity_code: rake || r.rake_commodity_code,
      rake_commodity_name: rakeEnriched?.rake_commodity_name || null,
      rake_commodity_group: rakeEnriched?.rake_commodity_group || null,
    };
  });
}

const app = express();

const port = process.env.PORT || 3000;

const localUser = {
  id: "local-user",
  email: "local@example.com",
  full_name: "Local User",
  role: "admin",
};

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const SUPER_ADMIN = {
  username: "6266782930",
  email: "6266782930",
  password: "123456",
};

const ADMIN_ROLES = ["super_admin", "admin"];
const ADMIN_ONLY_ENTITIES = new Set([
  "MaturedIndent",
  "UploadLog",
  "RailNotification",
  "UserSettings",
  "RailwayDictionary",
  "station_master",
  "unmapped_station_codes",
  "zone_master",
  "division_master",
  "state_master",
  "district_master",
]);

const USER_OWNED_ENTITIES = new Set([
  "UserNotificationPreference",
  "UserWatchlist",
  "SavedFilter",
]);

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    created_date: user.created_date,
    updated_date: user.updated_date,
  };
}

function getAuthToken(req) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) return parts[1];
  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function requireRoles(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth?.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

function requireEntityWritePermission(req, res, next) {
  if (req.method === "GET") return next();
  if (USER_OWNED_ENTITIES.has(req.params.entityName)) return next();
  if (
    req.params.entityName === "FreightMovement" &&
    ADMIN_ROLES.includes(req.auth?.role)
  ) {
    return next();
  }
  if (
    ADMIN_ONLY_ENTITIES.has(req.params.entityName) &&
    ADMIN_ROLES.includes(req.auth?.role)
  ) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

function normalizeStationCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

async function enrichStationFields(records, batchId) {
  const rows = Array.isArray(records) ? records : [];
  const stationPairs = rows.map((record) => ({
    from: normalizeStationCode(record.station_from),
    to: normalizeStationCode(record.station_to || record.raw_data?.Material),
  }));

  const codes = stationPairs
    .flatMap(({ from, to }) => [from, to])
    .filter(Boolean);
  let stationMap = {};
  try {
    stationMap = await bulkLookupStationMasters(codes);
  } catch {
    stationMap = {};
  }
  const unmappedCodes = new Set();

  const enriched = rows.map((record, index) => {
    const { from, to } = stationPairs[index];
    const fromStation = from ? stationMap[from] : null;
    const toStation = to ? stationMap[to] : null;

    if (from && !fromStation) unmappedCodes.add(from);
    if (to && !toStation) unmappedCodes.add(to);

    return {
      ...record,
      station_from: from || record.station_from,
      station_to: to || record.station_to,
      from_station_name: fromStation?.station_name || null,
      from_district: fromStation?.district || null,
      from_state: fromStation?.state || null,
      from_division: fromStation?.division || null,
      from_zone: fromStation?.zone || null,
      to_station_name: toStation?.station_name || null,
      to_district: toStation?.district || null,
      to_state: toStation?.state || null,
      to_division: toStation?.division || null,
      to_zone: toStation?.zone || null,
    };
  });

  if (unmappedCodes.size > 0) {
    await upsertUnmappedStationCodes([...unmappedCodes], { batchId }).catch(
      () => undefined
    );
  }

  return enriched;
}

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fois-api", storage: getStorageStatus() });
});

// Auth routes
app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "username, email, password are required" });
    }

    const existingByUsername = await findUserByIdentifier(username);
    const existingByEmail = await findUserByIdentifier(email);

    if (existingByUsername || existingByEmail) {
      return res.status(409).json({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await createUser({
      username: String(username),
      email: String(email),
      full_name: String(username),
      role: "user",
      password_hash: passwordHash,
    });

    return res.status(201).json(sanitizeUser(user));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { identifier, username, email, password } = req.body || {};
    const ident = identifier || username || email;

    if (!ident || !password) {
      return res
        .status(400)
        .json({ error: "identifier/username/email and password are required" });
    }

    const user = await findUserByIdentifier(ident);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.auth.sub);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(sanitizeUser(user));
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/users",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (_req, res, next) => {
    try {
      res.json(await listUsers());
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/admin/users/:id/role",
  requireAuth,
  requireRoles(["super_admin"]),
  async (req, res, next) => {
    try {
      res.json(await updateUserRole(req.params.id, req.body?.role));
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/admin/storage/counts",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (_req, res, next) => {
    try {
      res.json({ storage: getStorageStatus(), counts: await countTables() });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/admin/station-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const created = await createOrUpdateStation(req.body || {});
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/station-master", requireAuth, async (req, res, next) => {
  try {
    const search = req.query.search;
    const parsedLimit = Number(req.query.limit || 50);
    const parsedOffset = Number(req.query.offset || 0);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const offset =
      Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    console.log({
      search,
      limit,
      offset,
    });

    const data = await listStations({
      search,
      offset,
      limit,
    });
    res.json({ items: data.items, total: data.total });
  } catch (error) {
    next(error);
  }
});

app.delete(
  "/api/admin/station-master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      res.json(await deleteStationById(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

// -------------------------------------------------------------
// State Master & District Master CRUD Mappings (mastersController)
// -------------------------------------------------------------
app.get(
  "/api/state-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.getAllStates
);

// -------------------------------------------------------------
// Public Master Read Endpoints (Phase 3 helpers)
// -------------------------------------------------------------
// These are used by workspace dropdowns and must not 404.
// Requirement: authenticated GET only (no strict admin role gate).
app.get("/api/masters/states", requireAuth, async (req, res, next) => {
  try {
    const { Pool } = await import("pg");
    const databaseUrl =
      process.env.DATABASE_URL ||
      "postgresql://fois_user:fois_password@localhost:5432/fois_db";
    const pool = new Pool({ connectionString: databaseUrl });

    const result = await pool.query(
      `SELECT id, code, name, active
         FROM state_master
         WHERE active IS NULL OR active = TRUE
         ORDER BY code ASC`
    );

    await pool.end();
    return res.json({ items: result.rows, count: result.rowCount });
  } catch (e) {
    return res
      .status(500)
      .json({ error: e?.message || "Failed to load states" });
  }
});

app.post(
  "/api/state-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.createState
);
app.put(
  "/api/state-master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.updateState
);
app.delete(
  "/api/state-master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.deleteState
);

app.get(
  "/api/district-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.getAllDistricts
);
app.post(
  "/api/district-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.createDistrict
);
app.put(
  "/api/district-master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.updateDistrict
);
app.delete(
  "/api/district-master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.deleteDistrict
);

// -------------------------------------------------------------

app.get(
  "/api/station-master/export",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const data = await listStations({
        search: "",
        offset: 0,
        limit: 1000000,
      });
      const rows = data.items.map((i) => ({
        station_code: i.station_code,
        station_name: i.station_name,
        district: i.district || "",
        state: i.state || "",
        division: i.division || "",
        zone: i.zone || "",
        is_active: i.is_active ? "TRUE" : "FALSE",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "station_master");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="station_master.xlsx"'
      );
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/station-master/upload",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const { fileName, fileBase64 } = req.body || {};
      if (!fileName || !fileBase64) {
        return res
          .status(400)
          .json({ error: "fileName and fileBase64 are required" });
      }

      const batchId = `STNMASTER-${Date.now()}`;

      const { upsertUnmappedStationCodes } = await import(
        "./utils/stationMaster.js"
      );

      const buffer = Buffer.from(String(fileBase64), "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const rows = workbook.SheetNames.flatMap((sheetName) =>
        XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" })
      );

      const unmappedCandidates = new Set();
      const validationWarnings = [];
      const warningRows = [];
      let invalidRowCount = 0;
      let zonesCreatedTotal = 0;
      let divisionsCreatedTotal = 0;
      let statesCreatedTotal = 0;
      let districtsCreatedTotal = 0;

      let total = rows.length;
      let inserted = 0;
      let updated = 0;
      let failed = 0;

      for (const row of rows) {
        try {
          const station_code = String(
            row.station_code || row.stationCode || row.code || ""
          )
            .trim()
            .toUpperCase();
          const station_name = String(
            row.station_name || row.name || ""
          ).trim();
          const district = String(row.district || "").trim() || null;
          const state = String(row.state || "").trim() || null;
          const division = String(row.division || "").trim() || null;
          const zone = String(row.zone || "").trim() || null;
          const is_activeRaw = row.is_active ?? row.active ?? true;
          const is_active =
            typeof is_activeRaw === "string"
              ? !["false", "0", ""].includes(is_activeRaw.toLowerCase())
              : !!is_activeRaw;

          if (!station_code || !station_name) {
            failed++;
            continue;
          }

          const z = (zone || "").toString().trim().toUpperCase();
          const s = (state || "").toString().trim();
          const d = (district || "").toString().trim();
          const st = (division || "").toString().trim().toUpperCase();

          const warningsForRow = [];

          if (s && !d)
            warningsForRow.push({
              field: "district",
              message:
                "State provided but District missing; creating masters anyway in WARNING mode.",
              row,
            });
          if (d && !s)
            warningsForRow.push({
              field: "state",
              message:
                "District provided but State missing; creating masters anyway in WARNING mode.",
              row,
            });
          if (z && !st)
            warningsForRow.push({
              field: "division",
              message:
                "Zone provided but Division missing; creating masters anyway in WARNING mode.",
              row,
            });
          if (st && !z)
            warningsForRow.push({
              field: "zone",
              message:
                "Division provided but Zone missing; creating masters anyway in WARNING mode.",
              row,
            });
          if (warningsForRow.length > 0) {
            invalidRowCount += 1;
            validationWarnings.push(
              ...warningsForRow.map((w) => ({
                warning: w,
                station_code,
                line_index: row?.line_index ?? null,
              }))
            );
            warningRows.push({ station_code, warnings: warningsForRow, row });
          }

          const before = await getStationById(`st_${station_code}`);
          await createOrUpdateStation({
            id: `st_${station_code}`,
            station_code,
            station_name,
            district: district || null,
            state: state || null,
            division: division || null,
            zone: zone || null,
            is_active,
          });

          if (before) updated++;
          else inserted++;

          const hasAnyMapping = Boolean(district || state || division || zone);
          if (!hasAnyMapping) unmappedCandidates.add(station_code);
        } catch {
          failed++;
        }
      }

      if (unmappedCandidates.size > 0) {
        await upsertUnmappedStationCodes([...unmappedCandidates], { batchId });
      }

      res.json({
        total,
        inserted,
        updated,
        failed,
        batch_id: batchId,
        file_name: fileName,
        invalidRowCount,
        validationWarnings,
        warningRows,
        zonesCreated: zonesCreatedTotal,
        divisionsCreated: divisionsCreatedTotal,
        statesCreated: statesCreatedTotal,
        districtsCreated: districtsCreatedTotal,
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/admin/uploads/excel",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const { fileName, fileType, fileBase64 } = req.body || {};
      if (!fileName || !fileType || !fileBase64) {
        return res
          .status(400)
          .json({ error: "fileName, fileType, and fileBase64 are required" });
      }
      if (!["ODR", "MaturedIndent"].includes(fileType)) {
        return res
          .status(400)
          .json({ error: "fileType must be ODR or MaturedIndent" });
      }

      const batchId = generateBatchId();
      const buffer = Buffer.from(String(fileBase64), "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const sheetNames = Array.isArray(workbook.SheetNames)
        ? workbook.SheetNames
        : [];
      if (sheetNames.length === 0) {
        throw new Error("Workbook has no sheets");
      }

      let parsedRecords = [];
      let duplicatesFound = 0;
      let missingODRs = 0;

      let totalSheets = sheetNames.length;
      let processedSheets = 0;
      let failedSheets = 0;

      const sheetWiseStats = [];

      for (const sheetName of sheetNames) {
        const sheetStats = {
          sheetName,
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
          insertedRows: 0,
          updatedRows: 0,
        };

        try {
          const sheetRows = XLSX.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            { defval: "" }
          );

          sheetStats.totalRows = Array.isArray(sheetRows)
            ? sheetRows.length
            : 0;

          if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
            sheetStats.validRows = 0;
            sheetStats.invalidRows = 0;
            processedSheets++;
            sheetWiseStats.push(sheetStats);
            continue;
          }

          let sheetParsed = [];
          if (fileType === "ODR") {
            sheetParsed = sheetRows
              .map((row) => parseODRRow(row, batchId))
              .filter(Boolean);
          } else {
            let firstRejectedIndentRow = null;
            let firstRejectedIndentReason = "";
            sheetParsed = [];

            for (const row of sheetRows) {
              const parsed = parseIndentRow(row, batchId);
              if (parsed) {
                sheetParsed.push(parsed);
                continue;
              }

              if (!firstRejectedIndentRow) {
                firstRejectedIndentRow = row;
                firstRejectedIndentReason =
                  getIndentRowRejectionReason(row) ||
                  "Matured Indent row parser returned no record";
              }
            }

            const rejectedRows = sheetRows.length - sheetParsed.length;
            console.info(
              `[MaturedIndent Upload] sheet="${sheetName}" total rows read=${sheetRows.length}, accepted rows=${sheetParsed.length}, rejected rows=${rejectedRows}`
            );
            if (firstRejectedIndentRow) {
              console.warn("[MaturedIndent Upload] first rejected row", {
                sheetName,
                reason: firstRejectedIndentReason,
                row: firstRejectedIndentRow,
              });
            }
          }

          sheetStats.validRows = sheetParsed.length;
          sheetStats.invalidRows = sheetStats.totalRows - sheetStats.validRows;

          sheetParsed = await enrichStationFields(sheetParsed, batchId);
          sheetParsed = await enrichCommodityFields(sheetParsed);

          parsedRecords.push(...sheetParsed);
          processedSheets++;
          sheetWiseStats.push(sheetStats);
        } catch (sheetErr) {
          failedSheets++;
          sheetStats.invalidRows = sheetStats.totalRows;
          sheetStats.error_details = sheetErr?.message;
          sheetWiseStats.push(sheetStats);
        }
      }

      if (parsedRecords.length === 0) {
        throw new Error(
          "File has no valid data records across processed sheets"
        );
      }

      let insertedRecords = 0;
      let updatedRecords = 0;

      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";
      const pool = new Pool({ connectionString: databaseUrl });

      if (fileType === "ODR") {
        const countMap = {};
        parsedRecords.forEach((record) => {
          countMap[record.odr_number] = (countMap[record.odr_number] || 0) + 1;
        });

        parsedRecords = parsedRecords.map((record) => ({
          ...record,
          is_duplicate: countMap[record.odr_number] > 1,
        }));

        duplicatesFound = Object.values(countMap).filter(
          (count) => count > 1
        ).length;

        await createRecords("FreightMovement", parsedRecords);
        insertedRecords = parsedRecords.length;

        if (duplicatesFound > 0) {
          const eventKey = `DuplicateODR|${batchId}|${duplicatesFound}`;
          const existing = await pool.query(
            "SELECT id FROM notification_history WHERE event_key = $1 LIMIT 1",
            [eventKey]
          );
          if (existing.rows.length === 0) {
            await createNotification({
              movement_reference: null,
              station_code: null,
              notification_type: "DuplicateODR",
              type: "DuplicateODR",
              title: `${duplicatesFound} Duplicate Sr.No(s) Found`,
              message: `Batch ${batchId} - ${duplicatesFound} Sr.No values appear more than once in the uploaded file.`,
              severity: "warning",
              batch_id: batchId,
            });
          }
        }

        const existingIndents = await listRecords("MaturedIndent", {
          sort: "-created_date",
          limit: 500,
        });
        const { unmatchedIndents } = compareODRwithIndents(
          parsedRecords,
          existingIndents
        );
        missingODRs = unmatchedIndents.length;

        if (missingODRs > 0) {
          const eventKey = `MissingODR|${batchId}|${missingODRs}`;
          const existing = await pool.query(
            "SELECT id FROM notification_history WHERE event_key = $1 LIMIT 1",
            [eventKey]
          );
          if (existing.rows.length === 0) {
            await createNotification({
              movement_reference: null,
              station_code: null,
              notification_type: "MissingODR",
              type: "MissingODR",
              title: `${missingODRs} Missing ODR Alert(s)`,
              message: `Matured Indents without matching ODRs: ${unmatchedIndents
                .slice(0, 3)
                .map((indent) => indent.indent_number)
                .join(", ")}${missingODRs > 3 ? "..." : ""}`,
              severity: "error",
              batch_id: batchId,
            });
          }
        }
      } else {
        await createRecords("MaturedIndent", parsedRecords);
        insertedRecords = parsedRecords.length;

        const existingODR = await listRecords("FreightMovement", {
          sort: "-created_date",
          limit: 500,
        });
        const { unmatchedIndents } = compareODRwithIndents(
          existingODR,
          parsedRecords
        );
        missingODRs = unmatchedIndents.length;

        if (missingODRs > 0) {
          const eventKey = `MissingODR|${batchId}|${missingODRs}`;
          const existing = await pool.query(
            "SELECT id FROM notification_history WHERE event_key = $1 LIMIT 1",
            [eventKey]
          );
          if (existing.rows.length === 0) {
            await createNotification({
              movement_reference: null,
              station_code: null,
              notification_type: "MissingODR",
              type: "MissingODR",
              title: `${missingODRs} Indent(s) Without Matching ODR`,
              message: `Indents with no ODR match: ${unmatchedIndents
                .slice(0, 3)
                .map((indent) => indent.indent_number)
                .join(", ")}${missingODRs > 3 ? "..." : ""}`,
              severity: "error",
              batch_id: batchId,
            });
          }
        }
      }

      const totalValidAcrossSheets = sheetWiseStats.reduce(
        (acc, s) => acc + (s.validRows || 0),
        0
      );
      for (const s of sheetWiseStats) {
        const share =
          totalValidAcrossSheets > 0
            ? (s.validRows || 0) / totalValidAcrossSheets
            : 0;
        s.insertedRows = Math.round(share * insertedRecords);
        s.updatedRows = 0;
      }

      const logEntry = {
        batch_id: batchId,
        file_name: fileName,
        file_type: fileType,
        uploaded_by: req.auth?.username || "Admin",
        totalSheets,
        processedSheets,
        failedSheets,
        insertedRecords,
        updatedRecords,
        sheetWiseStats,
        duplicates_found: duplicatesFound,
        missing_odrs_found: missingODRs,
        status:
          processedSheets > 0
            ? failedSheets > 0
              ? "Partial"
              : "Success"
            : "Failed",
        upload_time: new Date().toISOString(),
      };

      await createRecord("UploadLog", logEntry);
      await pool.end();

      return res.status(201).json({
        success: true,
        ...logEntry,
        message: `Successfully processed ${processedSheets}/${totalSheets} sheet(s). Total valid records: ${parsedRecords.length}.`,
        storage: getStorageStatus(),
      });
    } catch (error) {
      const { fileName, fileType } = req.body || {};
      if (fileName && fileType) {
        await createRecord("UploadLog", {
          batch_id: generateBatchId(),
          file_name: fileName,
          file_type: fileType,
          uploaded_by: req.auth?.username || "Admin",
          status: "Failed",
          error_details: error.message,
          upload_time: new Date().toISOString(),
        }).catch(() => undefined);
      }
      next(error);
    }
  }
);

app.post(
  "/api/dashboard/freight/filter",
  requireAuth,
  async (req, res, next) => {
    try {
      const {
        entityType,
        dateType = "movement",
        dateRange = {},
        filters = {},
        pagination = {},
      } = req.body || {};

      const type = entityType || dateType || "movement";
      const tableName =
        type === "indent" ? "matured_indents" : "freight_movements";

      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";
      const pool = new Pool({ connectionString: databaseUrl });

      const where = [];
      const params = [];

      const addParam = (sqlFragment, value) => {
        params.push(value);
        where.push(sqlFragment.replace("$VALUE", `$${params.length}`));
      };

      const {
        zone,
        division,
        state,
        district,
        station,
        commodityGroup,
        commodity,
        rakeCommodity,
        movementType,
      } = filters || {};

      if (zone) {
        addParam(`(from_zone = $VALUE OR to_zone = $VALUE)`, zone);
      }
      if (division) {
        addParam(`(from_division = $VALUE OR to_division = $VALUE)`, division);
      }
      if (state) {
        addParam(`(from_state = $VALUE OR to_state = $VALUE)`, state);
      }
      if (district) {
        addParam(`(from_district = $VALUE OR to_district = $VALUE)`, district);
      }
      if (station) {
        addParam(`(station_from = $VALUE OR station_to = $VALUE)`, station);
      }

      if (commodityGroup) {
        addParam(`(commodity_group = $VALUE)`, commodityGroup);
      }
      if (commodity) {
        addParam(
          `(commodity_code = $VALUE OR commodity_name = $VALUE)`,
          commodity
        );
      }
      if (rakeCommodity) {
        addParam(
          `(rake_commodity_code = $VALUE OR rake_commodity_name = $VALUE)`,
          rakeCommodity
        );
      }

      if (movementType) {
        addParam(`(movement_type = $VALUE)`, movementType);
      }

      const rangeType = dateRange?.preset || "today";
      const customFrom = dateRange?.from;
      const customTo = dateRange?.to;

      const now = new Date();
      const toIso = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const date = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${date}`;
      };

      let fromDate = null;
      let toDate = null;

      if (rangeType === "today") {
        fromDate = toIso(now);
        toDate = toIso(now);
      } else if (rangeType === "7") {
        fromDate = toIso(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        toDate = toIso(now);
      } else if (rangeType === "30") {
        fromDate = toIso(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        toDate = toIso(now);
      } else if (rangeType === "custom") {
        fromDate = customFrom;
        toDate = customTo;
      }

      if (fromDate && toDate) {
        // Rebuild parameter stack to include the date range constraints.
        // Do NOT clear/duplicate param indices outside this block.
        const rebuildParams = [];
        const rebuildWhere = [];
        const rebuildAddParam = (sqlFragment, value) => {
          rebuildParams.push(value);
          rebuildWhere.push(
            sqlFragment.replace("$VALUE", `$${rebuildParams.length}`)
          );
        };

        if (zone) {
          rebuildAddParam(`(from_zone = $VALUE OR to_zone = $VALUE)`, zone);
        }
        if (division) {
          rebuildAddParam(
            `(from_division = $VALUE OR to_division = $VALUE)`,
            division
          );
        }
        if (state) {
          rebuildAddParam(`(from_state = $VALUE OR to_state = $VALUE)`, state);
        }
        if (district) {
          rebuildAddParam(
            `(from_district = $VALUE OR to_district = $VALUE)`,
            district
          );
        }
        if (station) {
          rebuildAddParam(
            `(station_from = $VALUE OR station_to = $VALUE)`,
            station
          );
        }
        if (commodityGroup) {
          rebuildAddParam(`(commodity_group = $VALUE)`, commodityGroup);
        }
        if (commodity) {
          rebuildAddParam(
            `(commodity_code = $VALUE OR commodity_name = $VALUE)`,
            commodity
          );
        }
        if (rakeCommodity) {
          rebuildAddParam(
            `(rake_commodity_code = $VALUE OR rake_commodity_name = $VALUE)`,
            rakeCommodity
          );
        }
        if (movementType) {
          rebuildAddParam(`(movement_type = $VALUE)`, movementType);
        }

        const pFrom = `$${rebuildParams.length + 1}`;
        const pTo = `$${rebuildParams.length + 2}`;
        rebuildParams.push(fromDate);
        rebuildParams.push(toDate);

        if (type === "indent") {
          rebuildWhere.push(
            `((indent_date::date BETWEEN ${pFrom} AND ${pTo}) OR (maturity_date::date BETWEEN ${pFrom} AND ${pTo}))`
          );
        } else {
          // Use created_date (upload date) for range filtering.
          // arrival_date/departure_date are historical movement dates from Excel
          // and will never match the current date preset, returning 0 rows.
          rebuildWhere.push(
            `(created_date::date BETWEEN ${pFrom} AND ${pTo})`
          );
        }

        const limit = Number(pagination.limit || 100);
        const offset = Number(pagination.offset || 0);

        const whereSql = rebuildWhere.length
          ? `WHERE ${rebuildWhere.join(" AND ")}`
          : "";
        // placeholder safety: LIMIT/OFFSET must map to the LAST indexes of finalParams
        const limitIndex = rebuildParams.length + 1;
        const offsetIndex = rebuildParams.length + 2;

        const sql = `SELECT * FROM ${tableName} ${whereSql} ORDER BY created_date DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
        const finalParams = [...rebuildParams, limit, offset];

        // If indexes ever drift (e.g., future code edits), this will fail fast.
        if (finalParams.length !== offsetIndex) {
          throw new Error(
            `Date filter parameter index mismatch: expected finalParams.length=${offsetIndex}, got ${finalParams.length}`
          );
        }

        const result = await pool.query(sql, finalParams);
        await pool.end();

        // freight_movements stores all freight fields inside `data JSONB`.
        // Raw result.rows have movement_type etc inside row.data, not top-level.
        // Must spread row.data to make movement_type, division, commodity etc accessible.
        const mapRow = (row) => ({
          ...(row.data && typeof row.data === 'object' ? row.data : {}),
          id: row.id,
          station_from: row.station_from,
          station_to: row.station_to,
          from_zone: row.from_zone,
          to_zone: row.to_zone,
          from_division: row.from_division,
          to_division: row.to_division,
          from_state: row.from_state,
          to_state: row.to_state,
          from_district: row.from_district,
          to_district: row.to_district,
          commodity_code: row.commodity_code,
          commodity_name: row.commodity_name,
          commodity_group: row.commodity_group,
          created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
          updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
        });

        return res.json({ items: result.rows.map(mapRow), count: result.rowCount });
      }

      const limit = Number(pagination.limit || 100);
      const offset = Number(pagination.offset || 0);
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `SELECT * FROM ${tableName} ${whereSql} ORDER BY created_date DESC LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}`;
      const finalParams = [...params, limit, offset];

      const result = await pool.query(sql, finalParams);
      await pool.end();

      const mapRow2 = (row) => ({
        ...(row.data && typeof row.data === 'object' ? row.data : {}),
        id: row.id,
        station_from: row.station_from,
        station_to: row.station_to,
        from_zone: row.from_zone,
        to_zone: row.to_zone,
        from_division: row.from_division,
        to_division: row.to_division,
        from_state: row.from_state,
        to_state: row.to_state,
        from_district: row.from_district,
        to_district: row.to_district,
        commodity_code: row.commodity_code,
        commodity_name: row.commodity_name,
        commodity_group: row.commodity_group,
        created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
        updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
      });

      return res.json({ items: result.rows.map(mapRow2), count: result.rowCount });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/entities/:entityName", requireAuth, async (req, res, next) => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const safeJsonParse = (value, context) => {
    if (value === undefined || value === null || value === "") return undefined;

    if (typeof value !== "string") return value;

    try {
      return JSON.parse(value);
    } catch (err) {
      const details = {
        request_id: requestId,
        context,
        raw_value_preview: String(value).slice(0, 200),
        raw_value_length: String(value).length,
      };
      console.error(
        "[GET /api/entities] filter_json_parse_failed",
        details,
        err
      );
      return undefined;
    }
  };

  const parsePositiveInt = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
  };

  try {
    const entityName = req.params.entityName;

    const filter = safeJsonParse(req.query.filter, "req.query.filter");

    const limit = parsePositiveInt(req.query.limit, 100);
    const offset = parsePositiveInt(req.query.offset, 0);

    const rawSort = req.query.sort;
    let sort =
      typeof rawSort === "string" && rawSort.trim()
        ? rawSort.trim()
        : undefined;

    // Special-case sort fallback for UserWatchlist (db column mismatch observed: created_at vs created_date)
    if (entityName === "UserWatchlist") {
      if (!sort) {
        // Prefer created_at when absent, but keep compatibility with existing listRecords expectations
        sort = "-created_at";
      }

      const wantsCreatedDate = sort === "-created_date";
      const wantsCreatedAt = sort === "-created_at";

      // If the client used the other column name, normalize to created_at as primary.
      // (listRecords may internally map sort fields; we keep both as best-effort)
      if (wantsCreatedDate) sort = "-created_at";
      if (wantsCreatedAt) sort = "-created_at";
    }

    const records = await listRecords(entityName, {
      sort,
      limit,
      offset,
      filter,
    });

    res.json(records);
  } catch (error) {
    console.error("[GET /api/entities] failed", {
      request_id: requestId,
      entityName: req.params.entityName,
      query: {
        filter:
          typeof req.query.filter === "string"
            ? req.query.filter.slice(0, 200)
            : req.query.filter,
        sort: req.query.sort,
        limit: req.query.limit,
        offset: req.query.offset,
      },
      error_message: error?.message,
      error_stack: error?.stack,
    });
    next(error);
  }
});

app.post(
  "/api/entities/:entityName",
  requireAuth,
  requireEntityWritePermission,
  async (req, res, next) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const entityName = req.params.entityName;
    const nowIso = new Date().toISOString();

    try {
      // Defensive copy; ensure req.body is an object
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const payload = { ...body };

      // Timestamp pre-population to avoid downstream timestamp dependency failures
      // - Prefer created_at/updated_at; also backfill created_date/updated_date for existing schemas.
      // - For UserWatchlist specifically, ensure both are present to avoid sort/write mismatches.
      const setIfMissing = (key, val) => {
        if (
          payload[key] === undefined ||
          payload[key] === null ||
          payload[key] === ""
        ) {
          payload[key] = val;
        }
      };

      // created_* / updated_* defaults
      setIfMissing("created_at", payload.created_at || nowIso);
      setIfMissing("updated_at", payload.updated_at || nowIso);
      setIfMissing("created_date", payload.created_date || nowIso);
      setIfMissing("updated_date", payload.updated_date || nowIso);

      if (entityName === "UserWatchlist") {
        // Explicitly normalize both created_at & created_date to the same timestamp if one was provided.
        const createdAt = payload.created_at || payload.created_date || nowIso;
        payload.created_at = createdAt;
        payload.created_date = createdAt;

        const updatedAt = payload.updated_at || payload.updated_date || nowIso;
        payload.updated_at = updatedAt;
        payload.updated_date = updatedAt;
      }

      const created = await createRecord(entityName, payload);
      res.status(201).json(created);
    } catch (error) {
      console.error("[POST /api/entities] failed", {
        request_id: requestId,
        entityName,
        payload_preview: (() => {
          try {
            return JSON.stringify(
              req.body && typeof req.body === "object" ? req.body : {},
              null,
              0
            ).slice(0, 500);
          } catch {
            return "[unserializable payload]";
          }
        })(),
        error_message: error?.message,
        error_stack: error?.stack,
      });
      next(error);
    }
  }
);

app.post(
  "/api/entities/:entityName/bulk",
  requireAuth,
  requireEntityWritePermission,
  async (req, res, next) => {
    try {
      const created = await createRecords(
        req.params.entityName,
        req.body?.records
      );
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/entities/:entityName/:id",
  requireAuth,
  requireEntityWritePermission,
  async (req, res, next) => {
    try {
      const updated = await updateRecord(
        req.params.entityName,
        req.params.id,
        req.body
      );
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/entities/:entityName/:id",
  requireAuth,
  requireEntityWritePermission,
  async (req, res, next) => {
    try {
      const result = await deleteRecord(req.params.entityName, req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// --- Quick Create Master Endpoints (Phase 2/3) ---
// These endpoints use a dedicated pg Pool instance to avoid reliance on internal storage.js pools.
// They are intentionally implemented with defensive validation + structured error logs.

// (Deduplication) `/api/masters/states` must exist exactly once.
// Note: handler is defined below in this file only.

app.post(
  "/api/masters/states",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const { name, code } = req.body || {};
    if (!name || !code) {
      return res
        .status(400)
        .json({ error: "State name and code are required" });
    }

    let seederPool = null;
    try {
      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";

      seederPool = new Pool({ connectionString: databaseUrl });

      const normalizedCode = String(code).trim().toUpperCase();
      const normalizedName = String(name).trim();

      const checkExist = await seederPool.query(
        "SELECT id FROM state_master WHERE UPPER(code) = $1 LIMIT 1",
        [normalizedCode]
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "State with this code already exists" });
      }

      const maxRes = await seederPool.query("SELECT id FROM state_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      // NOTE: verified schema from container: state_master has (id TEXT, code TEXT, name TEXT, parent_code TEXT?, active BOOLEAN?)
      // mastersController elsewhere uses (id, code, name, active, parent_code). Here we insert minimal columns.
      const result = await seederPool.query(
        "INSERT INTO state_master (id, name, code, active, parent_code) VALUES ($1, $2, $3, TRUE, NULL) RETURNING *",
        [String(nextId), normalizedName, normalizedCode]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("[POST /api/masters/states] failed", {
        request_id: requestId,
        error_message: error?.message,
        error_stack: error?.stack,
        payload_preview: (() => {
          try {
            return JSON.stringify({ name, code }, null, 0);
          } catch {
            return "[unserializable payload]";
          }
        })(),
      });
      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      if (seederPool) {
        try {
          await seederPool.end();
        } catch {
          // ignore
        }
      }
    }
  }
);

// Missing auth-only GET endpoint (dropdown-safe)
app.get("/api/masters/districts", requireAuth, async (req, res, next) => {
  try {
    const { Pool } = await import("pg");
    const databaseUrl =
      process.env.DATABASE_URL ||
      "postgresql://fois_user:fois_password@localhost:5432/fois_db";
    const pool = new Pool({ connectionString: databaseUrl });

    const { state_code, state_id } = req.query || {};

    const params = [];
    let where = "";

    const filterVal = (state_code || state_id || "").trim();
    if (filterVal) {
      params.push(filterVal);
      where = " WHERE parent_code = $1";
    }

    const sql = `SELECT id, code, name, parent_code, active
      FROM district_master${where}
      ORDER BY name ASC`;

    const result = await pool.query(sql, params);

    await pool.end();
    return res.json({ items: result.rows, count: result.rowCount });
  } catch (e) {
    return res
      .status(500)
      .json({ error: e?.message || "Failed to load districts" });
  }
});

app.post(
  "/api/masters/districts",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Requirement: district_master uses parent_code -> state.code hierarchy.
    // Frontend must send { name, code, parent_code }.
    const { name, code, parent_code } = req.body || {};
    if (!name || !parent_code) {
      return res
        .status(400)
        .json({ error: "District name and parent_code are required" });
    }


    let seederPool = null;
    const debug = {
      payload: req.body,
      checkExist: { sql: null, params: null },
      insert: { sql: null, params: null },
    };

    const safeStringify = (value) => {
      try {
        return JSON.stringify(value);
      } catch {
        return "[unserializable]";
      }
    };

    try {
      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";

      seederPool = new Pool({ connectionString: databaseUrl });

      const normalizedName = String(name).trim();
      const calculatedCode = code
        ? String(code).trim().toUpperCase()
        : normalizedName.slice(0, 3).toUpperCase();

      // Resolve state reference column: state_id/stateId/state or just accept whatever exists.
      const distSample = await seederPool.query(
        "SELECT * FROM district_master LIMIT 0"
      );
      const distCols = distSample.fields.map((f) => f.name);
      // Requirement: stop using state_id. District hierarchy uses district.parent_code -> state.code.
      const stateRefCol =
        distCols.find((c) => c === "parent_code") ||
        distCols.find((c) => c === "parentCode") ||
        "parent_code";


      debug.checkExist.sql = `SELECT id FROM district_master WHERE LOWER(name) = $1 AND ("${stateRefCol}" = $2) LIMIT 1`;
      debug.checkExist.params = [normalizedName.toLowerCase(), parent_code];


      const checkExist = await seederPool.query(
        debug.checkExist.sql,
        debug.checkExist.params
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "District already exists in this state" });
      }

      const maxRes = await seederPool.query("SELECT id FROM district_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      debug.insert.sql = `INSERT INTO district_master (id, name, code, active, "${stateRefCol}")
       VALUES ($1, $2, $3, TRUE, $4)
       RETURNING *`;
      debug.insert.params = [
        String(nextId),
        normalizedName,
        calculatedCode,
        parent_code,
      ];


      const result = await seederPool.query(
        debug.insert.sql,
        debug.insert.params
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      // Temporary: dump the real postgres error object + stack + query context
      console.error("[POST /api/masters/districts] caught error object:");
      console.error(error);
      console.error("[POST /api/masters/districts] debug context:", {
        request_id: requestId,
        error_message: error?.message,
        error_stack: error?.stack,
        payload: debug.payload,
        payload_string: safeStringify(debug.payload),
        checkExist: debug.checkExist,
        insert: debug.insert,
        // Helpful extras when available
        postgres_code: error?.code,
        postgres_detail: error?.detail,
        postgres_constraint: error?.constraint,
      });

      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      if (seederPool) {
        try {
          await seederPool.end();
        } catch {
          // ignore
        }
      }
    }
  }
);

app.post(
  "/api/masters/commodities",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const {
      commodity_code,
      commodity_name,
      commodity_group_code,
      commodity_group_name,
    } = req.body || {};

    if (!commodity_code || !commodity_name) {
      return res
        .status(400)
        .json({ error: "Commodity code and name are strictly required" });
    }

    let seederPool = null;
    try {
      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";

      seederPool = new Pool({ connectionString: databaseUrl });

      const normalizedCommodityCode = String(commodity_code)
        .trim()
        .toUpperCase();
      const normalizedCommodityName = String(commodity_name).trim();

      const checkExist = await seederPool.query(
        "SELECT id FROM commodity_master WHERE UPPER(commodity_code) = $1 LIMIT 1",
        [normalizedCommodityCode]
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "Commodity code already registered" });
      }

      const maxRes = await seederPool.query("SELECT id FROM commodity_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      const cgCode = commodity_group_code
        ? String(commodity_group_code).trim()
        : "GEN";
      const cgName = commodity_group_name
        ? String(commodity_group_name).trim()
        : "GENERAL";

      // Verified schema from container: commodity_master has (id, commodity_code, commodity_name, commodity_group_code, commodity_group_name, is_active)
      const result = await seederPool.query(
        `INSERT INTO commodity_master
        (id, commodity_code, commodity_name, commodity_group_code, commodity_group_name, is_active, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
       RETURNING *`,
        [
          String(nextId),
          normalizedCommodityCode,
          normalizedCommodityName,
          cgCode,
          cgName,
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("[POST /api/masters/commodities] failed", {
        request_id: requestId,
        error_message: error?.message,
        error_stack: error?.stack,
        payload_preview: (() => {
          try {
            return JSON.stringify({
              commodity_code,
              commodity_name,
              commodity_group_code,
              commodity_group_name,
            });
          } catch {
            return "[unserializable payload]";
          }
        })(),
      });
      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      if (seederPool) {
        try {
          await seederPool.end();
        } catch {
          // ignore
        }
      }
    }
  }
);

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || "Internal server error",
  });
});

await initializeStorage();
await ensureSuperAdminExists(SUPER_ADMIN);

console.log("Auth routes:");
for (const layer of app._router?.stack || []) {
  if (
    layer.route &&
    layer.route.path &&
    String(layer.route.path).startsWith("/api/auth")
  ) {
    console.log(
      ` - ${Object.keys(layer.route.methods)
        .filter(Boolean)
        .join(",")
        .toUpperCase()} ${layer.route.path}`
    );
  }
}

app.listen(port, async () => {
  console.log(`FOIS API listening on http://localhost:${port}`);
  // ==========================================================================
  // DEPLOYMENT SAFETY LOCK: Seeder locked because Excel Import is now active!
  // ==========================================================================
  console.log("[Startup Guard] Seeder engine is safely locked for deployment.");
});

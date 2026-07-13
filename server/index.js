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
  deleteUploadBatch,
  deleteRecord,
  ensureSuperAdminExists,
  findUserById,
  findUserByIdentifier,
  getStorageStatus,
  initializeStorage,
  listUploadHistory,
  listUsers,
  listRecords,
  updateUserRole,
  updateUserPassword,
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
  ensureCommodityCatalogTable,
  ensureGenericMasterTable,
  ensureStationMasterTable,
} from "./utils/masterCatalogMigration.js";
import {
  compareODRwithIndents,
  generateBatchId,
  getIndentRowRejectionReason,
  parseIndentRow,
  parseODRRow,
} from "../src/utils/odrcomparison.js";

// Import the new clean Phase-1 modular controller
import * as mastersController from "./controllers/mastersController.js";

const FOIS_BASE_UPLOAD_HEADER_GROUPS = [
  { label: "S.NO.", aliases: ["S.NO.", "S NO", "SR NO", "SR.NO."] },
  { label: "DVSN", aliases: ["DVSN", "DIVISION"] },
];

const FOIS_NUMBER_UPLOAD_HEADER_GROUPS = {
  ODR: { label: "NO.", aliases: ["NO."] },
  MaturedIndent: {
    label: "NO. / DEMAND NO.",
    aliases: ["NO.", "DEMAND NO.", "INDENT NO."],
  },
};

function getRequiredFoisHeaderGroups(fileType) {
  return [
    ...FOIS_BASE_UPLOAD_HEADER_GROUPS,
    FOIS_NUMBER_UPLOAD_HEADER_GROUPS[fileType] ||
      FOIS_NUMBER_UPLOAD_HEADER_GROUPS.ODR,
  ];
}

function normalizeUploadHeader(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getSheetCellText(sheet, row, col) {
  const cell = sheet?.[XLSX.utils.encode_cell({ r: row, c: col })];
  return String(cell?.w ?? cell?.v ?? "").trim();
}

function findFoisHeaderRow(sheet, fileType) {
  if (!sheet?.["!ref"]) return -1;

  const requiredHeaderGroups = getRequiredFoisHeaderGroups(fileType);
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let row = range.s.r; row <= range.e.r; row++) {
    const headers = new Set();
    for (let col = range.s.c; col <= range.e.c; col++) {
      const header = normalizeUploadHeader(getSheetCellText(sheet, row, col));
      if (header) headers.add(header);
    }

    if (
      requiredHeaderGroups.every((group) =>
        group.aliases.some((header) => headers.has(header))
      )
    ) {
      return row;
    }
  }

  return -1;
}

function sheetToFoisRows(sheet, fileType) {
  const headerRow = findFoisHeaderRow(sheet, fileType);
  if (headerRow < 0) {
    return {
      headerRowNumber: null,
      rows: XLSX.utils.sheet_to_json(sheet, { defval: "" }),
    };
  }

  return {
    headerRowNumber: headerRow + 1,
    rows: XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      range: headerRow,
    }),
  };
}

function createClientUploadError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function getRequiredFoisHeaderMessage(fileType) {
  return getRequiredFoisHeaderGroups(fileType)
    .map((group) => group.label)
    .join(", ");
}

function normalizeCommodityCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

const WAGON_STOCK_PREFIX_RE = /^(BOX|BOB|BOS|BCN|BTP|NMG)/;
const WAGON_STOCK_CODES = new Set([
  "BCN",
  "BCNA",
  "BCNAHSM1",
  "BCNHL",
  "BOBR",
  "BOBRN",
  "BOBRNHSM1",
  "BOBRNHSM2",
  "BOSM",
  "BOST",
  "BOXCL",
  "BOXN",
  "BOXNEL",
  "BOXNHA",
  "BOXNHL",
  "BOXNHL25T",
  "BOXNR",
  "BTPN",
  "NMG",
  "NMGH",
]);

function isWagonStockType(value) {
  const normalized = normalizeCommodityCode(value);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return true;
  if (WAGON_STOCK_CODES.has(normalized)) return true;
  return WAGON_STOCK_PREFIX_RE.test(normalized);
}

async function bulkLookupCommodityMasters(codes, type = 'Commodity') {
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

  await ensureCommodityCatalogTable(pool);

  const result = await pool.query(
    `SELECT code, name, commodity_code, commodity_name
     FROM commodity_master
     WHERE code = ANY($1::text[]) AND type = $2`,
    [unique, type]
  );

  const map = {};
  for (const row of result.rows) {
    const code = normalizeCommodityCode(row.code || row.commodity_code);
    map[code] = {
      commodity_code: code,
      commodity_name: row.name || row.commodity_name,
      commodity_group: null,
    };
  }

  await pool.end();
  return map;
}

async function bulkLookupRakeCommodityMasters(rakeCodes) {
  return bulkLookupCommodityMasters(rakeCodes, 'Rake CMDT');
}

async function enrichCommodityFields(records) {
  const rows = Array.isArray(records) ? records : [];
  const commodityCodes = rows
    .map((r) => normalizeCommodityCode(r.commodity))
    .filter(Boolean);
  const productCodes = rows
    .map((r) =>
      normalizeCommodityCode(r.product || r.product_code || r.raw_data?.Product)
    )
    .filter(Boolean);
  const companyCodes = rows
    .map((r) =>
      normalizeCommodityCode(r.company || r.company_code || r.raw_data?.Company || r.raw_data?.cnsr)
    )
    .filter(Boolean);
  const rakeCommodityCodes = rows
    .map((r) => normalizeCommodityCode(r.rake_cmdt))
    .filter(Boolean);
  const wagonTypeCodes = rows
    .map((r) => normalizeCommodityCode(r.wagon_type))
    .filter(Boolean);

  const [commodityMap, productMap, companyMap, rakeCommodityMap, wagonTypeMap] = await Promise.all([
    bulkLookupCommodityMasters(commodityCodes, 'Commodity'),
    bulkLookupCommodityMasters(productCodes, 'Product'),
    bulkLookupCommodityMasters(companyCodes, 'Company'),
    bulkLookupCommodityMasters(rakeCommodityCodes, 'Rake CMDT'),
    bulkLookupCommodityMasters(wagonTypeCodes, 'Wagon Type'),
  ]);

  return rows.map((r) => {
    const c = normalizeCommodityCode(r.commodity);
    const rawRakeType = normalizeCommodityCode(r.rake_type);
    const product = normalizeCommodityCode(r.product || r.product_code || r.raw_data?.Product);
    const company = normalizeCommodityCode(r.company || r.company_code || r.raw_data?.Company || r.raw_data?.cnsr);
    const rake = normalizeCommodityCode(r.rake_cmdt);
    const wagon = normalizeCommodityCode(r.wagon_type || (isWagonStockType(rawRakeType) ? rawRakeType : ""));
    const businessRakeType =
      product || (!isWagonStockType(rawRakeType) && rawRakeType !== rake ? rawRakeType : "");

    const commodityEnriched = c ? commodityMap[c] : null;
    const productEnriched = product ? productMap[product] : null;
    const companyEnriched = company ? companyMap[company] : null;
    const rakeEnriched = rake ? rakeCommodityMap[rake] : null;
    const wagonEnriched = wagon ? wagonTypeMap[wagon] : null;

    return {
      ...r,
      product_code: product || r.product_code,
      product_name: productEnriched?.commodity_name || r.product_name || null,
      company: company || r.company || null,
      company_code: company || r.company_code,
      company_name: companyEnriched?.commodity_name || r.company_name || r.raw_data?.Company || company || null,
      commodity_code: c || r.commodity_code,
      commodity_name: commodityEnriched?.commodity_name || null,
      commodity_group: null,

      rake_commodity_code: rake || r.rake_commodity_code,
      rake_commodity_name: rakeEnriched?.commodity_name || null,
      rake_commodity_group: null,

      rake_type: businessRakeType,
      rake_type_name: productEnriched?.commodity_name || r.rake_type_name || r.product_name || null,
      wagon_type: wagon || r.wagon_type || null,
      wagon_type_name: wagonEnriched?.commodity_name || r.wagon_type_name || null,
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
const passwordResetCodes = new Map();
const pendingUploadChunks = new Map();

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

async function createMovementPreferenceNotifications(records, batchId) {
  const groups = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const movementType = record.movement_type;
    if (!['Inward', 'Outward'].includes(movementType)) {
      console.info('[NotificationDelivery] skipped record without valid movement type', { batchId, record_id: record.id });
      continue;
    }
    const stationCode =
      movementType === "Outward"
        ? record.station_from
        : record.station_to || record.station_from;
    if (!stationCode) continue;

    const key = [movementType, stationCode].join("|");
    const group = groups.get(key) || {
      movementType,
      stationCode,
      records: [],
      exemplar: record,
    };
    group.records.push(record);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const type = group.movementType;
    const movement = group.exemplar || {};
    const details = [
      movement.company_name || movement.company_code || movement.company,
      movement.product_name || movement.product_code || movement.product,
      movement.rake_commodity_name || movement.rake_commodity_code || movement.rake_cmdt,
    ]
      .filter(Boolean)
      .join(", ");

    try {
      await createNotification({
        movement_reference: `${batchId}:${group.movementType}:${group.stationCode}`,
        station_code: group.stationCode,
        notification_type: type,
        type,
        title: `New ${group.movementType} FOIS Record`,
        message: `Station: ${group.stationCode}; Company/Commodity/Rake CMDT: ${details || '-'}; FNR/No.: ${movement.odr_number || movement.indent_no || '-'}; Upload Date: ${movement.created_date || new Date().toISOString()}.`,
        severity: "info",
        related_odr: movement.odr_number || null,
        related_division: movement.division || null,
        batch_id: batchId,
        data: { movement },
      });
    } catch (error) {
      console.error("[NotificationDelivery] in-app notification failed", {
        batchId,
        movement_type: group.movementType,
        station_code: group.stationCode,
        error: error?.message,
      });
    }
  }
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

app.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    if (!identifier) return res.status(400).json({ error: "Username or email is required" });
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.json({ message: "If the account exists, a reset code has been sent." });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    passwordResetCodes.set(String(user.id), { codeHash: await bcrypt.hash(code, 8), expiresAt: Date.now() + 10 * 60 * 1000 });
    let sent = false;
    if (process.env.EMAIL_PROVIDER === "aws_ses" && user.email) {
      try {
        const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
        const client = new SESClient({ region: process.env.AWS_REGION, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } });
        await client.send(new SendEmailCommand({ Source: process.env.SES_FROM_EMAIL, Destination: { ToAddresses: [user.email] }, Message: { Subject: { Data: "RailFlow password reset code", Charset: "UTF-8" }, Body: { Text: { Data: `Your RailFlow password reset code is ${code}. It expires in 10 minutes.`, Charset: "UTF-8" } } } }));
        sent = true;
      } catch (error) { console.error("[PasswordReset] SES delivery failed", error?.message); }
    }
    return res.json({ message: sent ? "Reset code sent to your email." : "Reset code generated for local development.", ...(process.env.NODE_ENV === "production" ? {} : { development_code: code }) });
  } catch (error) { next(error); }
});

app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const code = String(req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    if (!identifier || !code || password.length < 6) return res.status(400).json({ error: "Identifier, valid code and password of at least 6 characters are required" });
    const user = await findUserByIdentifier(identifier);
    const reset = user ? passwordResetCodes.get(String(user.id)) : null;
    if (!user || !reset || reset.expiresAt < Date.now() || !(await bcrypt.compare(code, reset.codeHash))) return res.status(400).json({ error: "Invalid or expired reset code" });
    await updateUserPassword(user.id, await bcrypt.hash(password, 10));
    passwordResetCodes.delete(String(user.id));
    return res.json({ message: "Password reset successful. You can now sign in." });
  } catch (error) { next(error); }
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

app.get("/api/masters/districts", requireAuth, async (req, res) => {
  try {
    const { Pool } = await import("pg");
    const databaseUrl = process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db";
    const pool = new Pool({ connectionString: databaseUrl });
    const state = String(req.query.state || "").trim().toUpperCase();
    const result = await pool.query(
      `SELECT id, code, name, parent_code, active
       FROM district_master
       WHERE (active IS NULL OR active = TRUE)
         AND ($1::text = '' OR parent_code = $1)
       ORDER BY name ASC`,
      [state]
    );
    await pool.end();
    return res.json({ items: result.rows, count: result.rowCount });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Failed to load districts" });
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
  "/api/district-master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  mastersController.deleteAllDistricts
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

app.get(
  "/api/admin/upload-history",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit || 100) || 100, 500);
      res.json(await listUploadHistory({ limit }));
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/admin/upload-history/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      res.json(await deleteUploadBatch(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/admin/uploads/excel/chunk",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  express.raw({ type: "application/octet-stream", limit: "1mb" }),
  async (req, res, next) => {
    try {
      const uploadId = String(req.query.uploadId || "").trim();
      const fileName = String(req.query.fileName || "").trim();
      const fileType = String(req.query.fileType || "").trim();
      const index = Number(req.query.index);
      const total = Number(req.query.total);
      if (!uploadId || !fileName || !["ODR", "MaturedIndent"].includes(fileType) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 100 || index >= total || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "Invalid upload chunk" });
      }
      const entry = pendingUploadChunks.get(uploadId) || { fileName, fileType, total, chunks: new Array(total), size: 0, createdAt: Date.now() };
      if (entry.fileName !== fileName || entry.fileType !== fileType || entry.total !== total) return res.status(400).json({ error: "Upload chunk metadata mismatch" });
      if (!entry.chunks[index]) { entry.chunks[index] = req.body; entry.size += req.body.length; }
      if (entry.size > 25 * 1024 * 1024) { pendingUploadChunks.delete(uploadId); return res.status(413).json({ error: "Excel file exceeds 25 MB" }); }
      pendingUploadChunks.set(uploadId, entry);
      const receivedCount = entry.chunks.reduce((count, chunk) => count + (Buffer.isBuffer(chunk) ? 1 : 0), 0);
      if (receivedCount !== total) return res.json({ success: true, received: receivedCount, total });

      pendingUploadChunks.delete(uploadId);
      const token = getAuthToken(req);
      const params = new URLSearchParams({ fileName, fileType });
      const upstream = await fetch(`http://127.0.0.1:${port}/api/admin/uploads/excel?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
        body: Buffer.concat(entry.chunks),
      });
      const payload = await upstream.json().catch(() => ({ error: "Upload processing failed" }));
      return res.status(upstream.status).json(payload);
    } catch (error) { next(error); }
  }
);

app.post(
  "/api/admin/uploads/excel",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  express.raw({ type: "application/octet-stream", limit: "25mb" }),
  async (req, res, next) => {
    try {
      const isBinaryUpload = Buffer.isBuffer(req.body);
      const fileName = isBinaryUpload ? req.query.fileName : req.body?.fileName;
      const fileType = isBinaryUpload ? req.query.fileType : req.body?.fileType;
      const fileBase64 = isBinaryUpload ? null : req.body?.fileBase64;
      if (!fileName || !fileType || (!isBinaryUpload && !fileBase64)) {
        return res
          .status(400)
          .json({ error: "fileName, fileType, and file content are required" });
      }
      if (!["ODR", "MaturedIndent"].includes(fileType)) {
        return res
          .status(400)
          .json({ error: "fileType must be ODR or MaturedIndent" });
      }

      const batchId = generateBatchId();
      const buffer = isBinaryUpload ? req.body : Buffer.from(String(fileBase64), "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const sheetNames = Array.isArray(workbook.SheetNames)
        ? workbook.SheetNames
        : [];
      if (sheetNames.length === 0) {
        throw createClientUploadError("Workbook has no sheets");
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
          headerRow: null,
        };

        try {
          const { rows: sheetRows, headerRowNumber } = sheetToFoisRows(
            workbook.Sheets[sheetName],
            fileType
          );
          sheetStats.headerRow = headerRowNumber;

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
        throw createClientUploadError(
          `File has no valid data records across processed sheets. Required FOIS headers: ${getRequiredFoisHeaderMessage(
            fileType
          )}.`
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
        await createMovementPreferenceNotifications(parsedRecords, batchId).catch((error) => {
          console.error("[NotificationDelivery] movement preference notifications failed", {
            batchId,
            error: error?.message,
          });
        });

        const existingIndents = await listRecords("MaturedIndent", {
          sort: "-created_date",
          limit: 500,
        });
        const { unmatchedIndents } = compareODRwithIndents(
          parsedRecords,
          existingIndents
        );
        missingODRs = unmatchedIndents.length;

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

      }

      const totalValidAcrossSheets = sheetWiseStats.reduce(
        (acc, s) => acc + (s.validRows || 0),
        0
      );
      const recordsParsed = sheetWiseStats.reduce(
        (acc, s) => acc + (s.totalRows || 0),
        0
      );
      const recordsValid = parsedRecords.length;
      const recordsFailed = Math.max(recordsParsed - recordsValid, 0);
      for (const s of sheetWiseStats) {
        const share =
          totalValidAcrossSheets > 0
            ? (s.validRows || 0) / totalValidAcrossSheets
            : 0;
        s.insertedRows = Math.round(share * insertedRecords);
        s.updatedRows = 0;
      }

      const uploadTime = new Date().toISOString();
      const uploadStatus =
        processedSheets > 0
          ? failedSheets > 0
            ? "Partial"
            : "Completed"
          : "Failed";
      const logEntry = {
        batch_id: batchId,
        original_file_name: fileName,
        file_name: fileName,
        file_type: fileType,
        uploaded_by: req.auth?.username || "Admin",
        uploaded_at: uploadTime,
        record_count: insertedRecords,
        records_parsed: recordsParsed,
        records_valid: recordsValid,
        records_failed: recordsFailed,
        totalSheets,
        processedSheets,
        failedSheets,
        insertedRecords,
        updatedRecords,
        sheetWiseStats,
        duplicates_found: duplicatesFound,
        missing_odrs_found: missingODRs,
        status: uploadStatus,
        upload_time: uploadTime,
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
        const uploadTime = new Date().toISOString();
        await createRecord("UploadLog", {
          batch_id: generateBatchId(),
          original_file_name: fileName,
          file_name: fileName,
          file_type: fileType,
          uploaded_by: req.auth?.username || "Admin",
          uploaded_at: uploadTime,
          record_count: 0,
          records_parsed: 0,
          records_valid: 0,
          records_failed: 0,
          status: "Failed",
          error_details: error.message,
          upload_time: uploadTime,
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

app.get("/api/notifications", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.auth?.id || req.auth?.sub || "");
    const rows = await listRecords("RailNotification", { sort: "-created_date", limit: 100 });
    const allowed = rows.filter((item) => ["inward", "outward"].includes(String(item.type || "").toLowerCase()));
    res.json(allowed.map((item) => ({ ...item, is_read: (item.read_by || []).includes(userId) })));
  } catch (error) { next(error); }
});

app.post("/api/notifications/mark-all-read", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.auth?.id || req.auth?.sub || "");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const rows = await listRecords("RailNotification", { sort: "-created_date", limit: 10000 });
    const allowed = rows.filter((item) => ["inward", "outward"].includes(String(item.type || "").toLowerCase()));
    let updated = 0;
    for (const item of allowed) {
      const readBy = [...new Set([...(Array.isArray(item.read_by) ? item.read_by : []), userId])];
      if (readBy.length !== (item.read_by || []).length) { await updateRecord("RailNotification", item.id, { read_by: readBy }); updated += 1; }
    }
    res.json({ success: true, updated });
  } catch (error) { next(error); }
});

app.post("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.auth?.id || req.auth?.sub || "");
    const rows = await listRecords("RailNotification", { filter: { id: req.params.id }, limit: 1 });
    const item = rows[0];
    if (!item || !["inward", "outward"].includes(String(item.type || "").toLowerCase())) return res.status(404).json({ error: "Notification not found" });
    const readBy = [...new Set([...(Array.isArray(item.read_by) ? item.read_by : []), userId])];
    await updateRecord("RailNotification", item.id, { read_by: readBy });
    res.json({ success: true });
  } catch (error) { next(error); }
});

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

app.get(
  "/api/masters/commodities",
  requireAuth,
  async (req, res) => {
    try {
      const type = String(req.query.type || "Commodity").trim();
      const search = String(req.query.search || "").trim();
      const result = await withCatalogPool(async (pool) => {
        await ensureCommodityCatalogTable(pool);
        const params = [type];
        let where = "";
        if (search) {
          params.push(`%${search}%`);
          where = "AND (code ILIKE $2 OR name ILIKE $2 OR commodity_code ILIKE $2 OR commodity_name ILIKE $2)";
        }
        return pool.query(
          `SELECT id, code, name, commodity_code, commodity_name, type, is_active
             FROM commodity_master
            WHERE type = $1 ${where}
            ORDER BY code ASC`,
          params
        );
      });
      return res.json({
        items: result.rows.map((row) => ({
          id: row.id,
          code: row.code || row.commodity_code,
          full_name: row.name || row.commodity_name,
          name: row.name || row.commodity_name,
          type: row.type,
          active: row.is_active,
        })),
        count: result.rowCount,
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to load commodities" });
    }
  }
);

app.post(
  "/api/masters/commodities",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const code = req.body.code || req.body.commodity_code;
    const full_name = req.body.full_name || req.body.commodity_name;
    const type = req.body.type || "Commodity";

    if (!code || !full_name) {
      return res
        .status(400)
        .json({ error: "Code and Full Name are strictly required" });
    }

    let seederPool = null;
    try {
      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://fois_user:fois_password@localhost:5432/fois_db";

      seederPool = new Pool({ connectionString: databaseUrl });
      await ensureCommodityCatalogTable(seederPool);

      const normalizedCode = String(code).trim().toUpperCase();
      const normalizedName = String(full_name).trim();

      const checkExist = await seederPool.query(
        "SELECT id FROM commodity_master WHERE UPPER(code) = $1 AND type = $2 LIMIT 1",
        [normalizedCode, type]
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "Code already registered for this type" });
      }

      const maxRes = await seederPool.query("SELECT id FROM commodity_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      const result = await seederPool.query(
        `INSERT INTO commodity_master
        (id, code, name, commodity_code, commodity_name, type, commodity_group_code, commodity_group_name, is_active, created_at, updated_at)
       VALUES
        ($1, $2, $3, $2, $3, $4, NULL, NULL, TRUE, NOW(), NOW())
       ON CONFLICT (code, type) DO UPDATE SET
        name = EXCLUDED.name,
        commodity_code = EXCLUDED.commodity_code,
        commodity_name = EXCLUDED.commodity_name,
        updated_at = NOW()
       RETURNING *`,
        [
          String(nextId),
          normalizedCode,
          normalizedName,
          type,
        ]
      );

      const row = result.rows[0];
      return res.status(201).json({
        id: row.id,
        code: row.code || row.commodity_code,
        full_name: row.name || row.commodity_name,
        type: row.type,
      });
    } catch (error) {
      console.error("[POST /api/masters/commodities] failed", {
        request_id: requestId,
        error_message: error?.message,
        error_stack: error?.stack,
        payload_preview: JSON.stringify(req.body),
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

const MASTER_CATALOGS = {
  state: { table: "state_master", kind: "generic", label: "State" },
  district: { table: "district_master", kind: "generic", label: "District" },
  zone: { table: "zone_master", kind: "generic", label: "Zone" },
  division: { table: "division_master", kind: "generic", label: "Division" },
  station: { table: "station_master", kind: "station", label: "Station" },
  commodity: { table: "commodity_master", kind: "typedCommodity", type: "Commodity", label: "Commodity" },
  rakeCommodity: { table: "commodity_master", kind: "typedCommodity", type: "Rake CMDT", label: "Rake CMDT" },
  company: { table: "commodity_master", kind: "typedCommodity", type: "Company", label: "Company" },
  product: { table: "commodity_master", kind: "typedCommodity", type: "Product", label: "Product" },
};

const MASTER_CATALOG_ALIASES = {
  states: "state",
  districts: "district",
  zones: "zone",
  divisions: "division",
  stations: "station",
  commodities: "commodity",
  "rake-cmdt": "rakeCommodity",
  rake_cmdt: "rakeCommodity",
};

const MASTER_CATALOG_RESPONSE_KEYS = {
  state: "states",
  district: "districts",
  zone: "zones",
  division: "divisions",
  station: "stations",
  commodity: "commodity",
  company: "company",
  product: "product",
};

function resolveMasterKey(master) {
  const key = String(master || "").trim().toLowerCase();
  return MASTER_CATALOGS[key] ? key : MASTER_CATALOG_ALIASES[key];
}

async function withCatalogPool(callback) {
  const { Pool } = await import("pg");
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://fois_user:fois_password@localhost:5432/fois_db";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await callback(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function ensureCatalogTable(pool, config) {
  if (config.kind === "station") {
    await ensureStationMasterTable(pool);
    return;
  }

  if (config.kind === "typedCommodity") {
    await ensureCommodityCatalogTable(pool);
    return;
  }

  await ensureGenericMasterTable(pool, config.table);
}

function normalizeCatalogRow(config, row) {
  if (config.kind === "station") {
    return {
      id: row.id,
      code: row.station_code,
      name: row.station_name,
      station_code: row.station_code,
      station_name: row.station_name,
      district: row.district,
      state: row.state,
      division: row.division,
      zone: row.zone,
      active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  if (config.kind === "typedCommodity") {
    return {
      id: row.id,
      code: row.code || row.commodity_code,
      name: row.name || row.commodity_name,
      full_name: row.name || row.commodity_name,
      type: row.type,
      active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  return row;
}

function catalogId(prefix, code) {
  return `${prefix}_${String(code || "").trim().toUpperCase()}`;
}

async function listCatalogRecords(pool, masterKey, { search = "", limit = 10000, offset = 0 } = {}) {
  const resolvedKey = resolveMasterKey(masterKey);
  const config = MASTER_CATALOGS[resolvedKey];
  if (!config) throw new Error("Unknown master");
  await ensureCatalogTable(pool, config);

  const params = [];
  let where = "";
  if (config.kind === "station") {
    if (search) {
      params.push(`%${search}%`);
      where =
        "WHERE station_code ILIKE $1 OR station_name ILIKE $1 OR district ILIKE $1 OR state ILIKE $1 OR division ILIKE $1 OR zone ILIKE $1";
    }
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM station_master ${where}`, params);
    const rows = await pool.query(
      `SELECT * FROM station_master ${where} ORDER BY station_code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { rows: rows.rows, total: count.rows[0]?.total || 0, config };
  }

  if (config.kind === "typedCommodity") {
    params.push(config.type);
    if (search) {
      params.push(`%${search}%`);
      where = "AND (code ILIKE $2 OR name ILIKE $2 OR commodity_code ILIKE $2 OR commodity_name ILIKE $2)";
    }
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM commodity_master WHERE type = $1 ${where}`,
      params
    );
    const rows = await pool.query(
      `SELECT * FROM commodity_master WHERE type = $1 ${where} ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { rows: rows.rows, total: count.rows[0]?.total || 0, config };
  }

  if (search) {
    params.push(`%${search}%`);
    where = "WHERE code ILIKE $1 OR name ILIKE $1 OR parent_code ILIKE $1";
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${config.table} ${where}`, params);
  const rows = await pool.query(
    `SELECT * FROM ${config.table} ${where} ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { rows: rows.rows, total: count.rows[0]?.total || 0, config };
}

async function requireMasterReference(pool, tableName, code, label) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw new Error(`${label} is required`);
  const result = await pool.query(
    `SELECT id FROM ${tableName} WHERE code = $1 LIMIT 1`,
    [normalized]
  );
  if (result.rows.length === 0) {
    throw new Error(`${label} '${normalized}' does not exist`);
  }
  return normalized;
}

async function requireDistrictReference(pool, stateCode, districtCode) {
  const state = String(stateCode || "").trim().toUpperCase();
  const district = String(districtCode || "").trim().toUpperCase();
  if (!state) throw new Error("State is required");
  if (!district) throw new Error("District is required");
  const result = await pool.query(
    `SELECT id FROM district_master WHERE code = $1 AND parent_code = $2 LIMIT 1`,
    [district, state]
  );
  if (result.rows.length === 0) {
    throw new Error(`District '${district}' does not exist for state '${state}'`);
  }
  return district;
}

async function requireDivisionReference(pool, zoneCode, divisionCode) {
  const zone = String(zoneCode || "").trim().toUpperCase();
  const division = String(divisionCode || "").trim().toUpperCase();
  if (!zone) throw new Error("Zone is required");
  if (!division) throw new Error("Division is required");
  const result = await pool.query(
    `SELECT id FROM division_master WHERE code = $1 AND parent_code = $2 LIMIT 1`,
    [division, zone]
  );
  if (result.rows.length === 0) {
    throw new Error(`Division '${division}' does not exist for zone '${zone}'`);
  }
  return division;
}

app.get(
  "/api/masters/catalog",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    try {
      const type = String(req.query.type || "").trim();
      const resolvedType = type ? resolveMasterKey(type) : null;
      if (type && !resolvedType) return res.status(404).json({ error: "Unknown master" });
      const keys = resolvedType ? [resolvedType] : Object.keys(MASTER_CATALOGS);
      const data = await withCatalogPool(async (pool) => {
        const entries = {};
        for (const key of keys) {
          if (!MASTER_CATALOGS[key]) continue;
          const result = await listCatalogRecords(pool, key, {
            search: String(req.query.search || "").trim(),
            limit: Math.min(Number(req.query.limit || 10000) || 10000, 10000),
            offset: Number(req.query.offset || 0) || 0,
          });
          entries[MASTER_CATALOG_RESPONSE_KEYS[key] || key] = {
            items: result.rows.map((row) => normalizeCatalogRow(result.config, row)),
            total: result.total,
          };
        }
        return entries;
      });

      const responseKey = resolvedType ? MASTER_CATALOG_RESPONSE_KEYS[resolvedType] || resolvedType : null;
      return res.json(responseKey ? data[responseKey] || { items: [], total: 0 } : data);
    } catch (error) {
      console.error("[GET /api/masters/catalog] failed", error);
      return res.status(500).json({ error: "Failed to load master catalog" });
    }
  }
);

app.get(
  "/api/masters/catalog/:master",
  requireAuth,
  async (req, res) => {
    const masterKey = resolveMasterKey(req.params.master);
    const config = MASTER_CATALOGS[masterKey];
    if (!config) return res.status(404).json({ error: "Unknown master" });

    try {
      const result = await withCatalogPool((pool) =>
        listCatalogRecords(pool, masterKey, {
          search: String(req.query.search || "").trim(),
          limit: Math.min(Number(req.query.limit || 25) || 25, 500),
          offset: Number(req.query.offset || 0) || 0,
        })
      );

      return res.json({
        items: result.rows.map((row) => normalizeCatalogRow(result.config, row)),
        total: result.total,
      });
    } catch (error) {
      console.error("[GET /api/masters/catalog] failed", error);
      return res.status(500).json({ error: "Failed to load master" });
    }
  }
);

app.post(
  "/api/masters/catalog/:master",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const masterKey = resolveMasterKey(req.params.master);
    const config = MASTER_CATALOGS[masterKey];
    if (!config) return res.status(404).json({ error: "Unknown master" });

    try {
      const row = await withCatalogPool(async (pool) => {
        await ensureCatalogTable(pool, config);
        const body = req.body || {};

        if (config.kind === "station") {
          const code = String(body.station_code || body.code || "").trim().toUpperCase();
          const name = String(body.station_name || body.name || "").trim();
          if (!code || !name) throw new Error("Station code and name are required");
          const state = await requireMasterReference(pool, "state_master", body.state, "State");
          const district = await requireDistrictReference(pool, state, body.district);
          const zone = await requireMasterReference(pool, "zone_master", body.zone, "Zone");
          const division = await requireDivisionReference(pool, zone, body.division);
          const id = body.id || `st_${code}`;
          const result = await pool.query(
            `INSERT INTO station_master (id, station_code, station_name, district, state, division, zone, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
             ON CONFLICT (station_code) DO UPDATE SET station_name = EXCLUDED.station_name, district = EXCLUDED.district, state = EXCLUDED.state, division = EXCLUDED.division, zone = EXCLUDED.zone, updated_at = NOW()
             RETURNING *`,
            [id, code, name, district, state, division, zone]
          );
          return result.rows[0];
        }

        if (config.kind === "typedCommodity") {
          const code = String(body.code || body.commodity_code || "").trim().toUpperCase();
          const name = String(body.name || body.full_name || body.commodity_name || "").trim();
          if (!code || !name) throw new Error(`${config.label} code and name are required`);
          const id = body.id || catalogId(config.type.toLowerCase(), code);
          const result = await pool.query(
            `INSERT INTO commodity_master (id, code, name, commodity_code, commodity_name, type, commodity_group_code, commodity_group_name, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $2, $3, $4, NULL, NULL, TRUE, NOW(), NOW())
             ON CONFLICT (code, type) DO UPDATE SET name = EXCLUDED.name, commodity_code = EXCLUDED.commodity_code, commodity_name = EXCLUDED.commodity_name, commodity_group_code = NULL, commodity_group_name = NULL, updated_at = NOW()
             RETURNING *`,
            [id, code, name, config.type]
          );
          return result.rows[0];
        }

        const name = String(body.name || "").trim();
        const generatedDistrictCode = masterKey === "district"
          ? `${parentCode}_${name}`.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()
          : "";
        const code = String(body.code || generatedDistrictCode).trim().toUpperCase();
        if (!code || !name) throw new Error(masterKey === "district" ? "District name is required" : `${config.label} code and name are required`);
        let parentCode = body.parent_code ? String(body.parent_code).trim().toUpperCase() : null;
        if (masterKey === "district") {
          parentCode = await requireMasterReference(pool, "state_master", parentCode, "Parent State");
        }
        if (masterKey === "division") {
          parentCode = await requireMasterReference(pool, "zone_master", parentCode, "Zone");
        }
        const id = body.id || catalogId(config.table, code);
        const result = await pool.query(
          `INSERT INTO ${config.table} (id, code, name, parent_code, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, parent_code = EXCLUDED.parent_code, updated_at = NOW()
           RETURNING *`,
          [id, code, name, parentCode]
        );
        return result.rows[0];
      });

      return res.status(201).json(normalizeCatalogRow(config, row));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Failed to save master" });
    }
  }
);

app.put(
  "/api/masters/catalog/:master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const masterKey = resolveMasterKey(req.params.master);
    const config = MASTER_CATALOGS[masterKey];
    if (!config) return res.status(404).json({ error: "Unknown master" });

    try {
      const row = await withCatalogPool(async (pool) => {
        await ensureCatalogTable(pool, config);
        const body = req.body || {};

        if (config.kind === "station") {
          const code = String(body.station_code || body.code || "").trim().toUpperCase();
          const name = String(body.station_name || body.name || "").trim();
          if (!code || !name) throw new Error("Station code and name are required");
          const state = await requireMasterReference(pool, "state_master", body.state, "State");
          const district = await requireDistrictReference(pool, state, body.district);
          const zone = await requireMasterReference(pool, "zone_master", body.zone, "Zone");
          const division = await requireDivisionReference(pool, zone, body.division);
          const result = await pool.query(
            `UPDATE station_master SET station_code = $1, station_name = $2, district = $3, state = $4, division = $5, zone = $6, updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [
              code,
              name,
              district,
              state,
              division,
              zone,
              req.params.id,
            ]
          );
          return result.rows[0];
        }

        if (config.kind === "typedCommodity") {
          const code = String(body.code || body.commodity_code || "").trim().toUpperCase();
          const name = String(body.name || body.full_name || body.commodity_name || "").trim();
          if (!code || !name) throw new Error(`${config.label} code and name are required`);
          const result = await pool.query(
            `UPDATE commodity_master SET code = $1, name = $2, commodity_code = $1, commodity_name = $2, type = $3, commodity_group_code = NULL, commodity_group_name = NULL, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [
              code,
              name,
              config.type,
              req.params.id,
            ]
          );
          return result.rows[0];
        }

        let parentCode = body.parent_code ? String(body.parent_code).trim().toUpperCase() : null;
        if (masterKey === "district") {
          parentCode = await requireMasterReference(pool, "state_master", parentCode, "Parent State");
        }
        if (masterKey === "division") {
          parentCode = await requireMasterReference(pool, "zone_master", parentCode, "Zone");
        }
        const name = String(body.name || "").trim();
        let code = String(body.code || "").trim().toUpperCase();
        if (masterKey === "district") {
          const existing = await pool.query(`SELECT code FROM district_master WHERE id = $1 LIMIT 1`, [req.params.id]);
          code = existing.rows[0]?.code || "";
        }
        if (!code || !name) throw new Error(masterKey === "district" ? "District name is required" : `${config.label} code and name are required`);
        const result = await pool.query(
          `UPDATE ${config.table} SET code = $1, name = $2, parent_code = $3, updated_at = NOW()
           WHERE id = $4 RETURNING *`,
          [
            code,
            name,
            parentCode,
            req.params.id,
          ]
        );
        return result.rows[0];
      });

      if (!row) return res.status(404).json({ error: "Master record not found" });
      return res.json(normalizeCatalogRow(config, row));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Failed to update master" });
    }
  }
);

app.delete(
  "/api/masters/catalog/:master/:id",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const config = MASTER_CATALOGS[resolveMasterKey(req.params.master)];
    if (!config) return res.status(404).json({ error: "Unknown master" });

    try {
      await withCatalogPool(async (pool) => {
        await ensureCatalogTable(pool, config);
        const table = config.table;
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      });
      return res.json({ id: req.params.id, deleted: true });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Failed to delete master" });
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

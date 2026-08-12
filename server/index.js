import "./loadEnv.js";
import crypto from "crypto";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as XLSX from "xlsx";
import { pool } from "./db/pool.js";
import { runSeeder, runZoneDivisionSeeder } from "../scripts/seedMasters.js";
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
  markAllNotificationsRead,
  updateUserRole,
  updateUserPassword,
  updateRecord,
} from "./storage.js";

import { createNotification } from "./notifications/service.js";
import { filterHierarchy, movementDashboardSummary, pagedFoisReports, pagedMovements, unmappedSummary } from "./movementQueries.js";
import { invalidateCachePrefix } from "./cache.js";
import { generateBusinessKey, generateRecordHash, aggregateMultiLineIndents } from "./services/incrementalUploadEngine.js";
import {
  ensureMatchingSchema,
  getMatchingSummary,
  listMatchingResults,
  runMatchingEngine,
} from "./services/matchingEngine.js";
import {
  comparisonDetail,
  comparisonFilterOptions,
  comparisonAnalytics,
  comparisonRecords,
  getRules,
  matchingRuns,
  resolveComparison,
  saveRules,
  unmatchComparison,
  userFreightRecords,
  userFreightSummary,
  userTimeline,
} from "./services/comparisonService.js";

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
  formatUniqueRakeCode,
  generateBatchId,
  getIndentRowRejectionReason,
  parseIndentRow,
  parseODRRow,
} from "../src/utils/odrcomparison.js";
import { USER_CATEGORIES } from "../src/utils/userCategories.js";

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

const DEFAULT_ODR_HEADERS = [
  "S.NO.", "DVSN", "STTN FROM", "NO.", "DATE", "TIME",
  "EXPECTED LOADING DATE", "CNSR", "CNSG", "CMDT",
  "TT", "PC", "PBF", "VIA", "RAKE CMDT",
  "DSTN", "TYPE", "INDENTED UNTS", "INDENTED 8W", "OTSG UNTS",
  "OTSG 8W", "SUPPLIED UNTS", "SUPPLIED TIME"
];

const DEFAULT_MATURED_HEADERS = [
  "S.NO.", "DVSN", "STTN FROM", "DEMAND NO.", "DEMAND DATE", "DEMAND TIME",
  "EXPECTED LOADING DATE", "CONSIGNOR", "CNSG", "CMDT",
  "TT", "PC", "PBF", "VIA", "RAKE CMDT",
  "DSTN", "TYPE", "INDENTED UNTS", "INDENTED 8W", "OTSG UNTS",
  "OTSG 8W", "SUPPLIED UNTS", "SUPPLIED TIME"
];

function sheetToFoisRows(sheet, fileType) {
  const headerRow = findFoisHeaderRow(sheet, fileType);
  if (headerRow >= 0) {
    return {
      headerRowNumber: headerRow + 1,
      rows: XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        range: headerRow,
        raw: true,
      }),
    };
  }

  // Header row not found in uploaded sheet -> auto-inject default FOIS headers
  const rawAoA = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (!Array.isArray(rawAoA) || rawAoA.length === 0) {
    return { headerRowNumber: null, rows: [] };
  }

  const defaultHeaders = fileType === "ODR" ? DEFAULT_ODR_HEADERS : DEFAULT_MATURED_HEADERS;
  const aoaWithHeaders = [defaultHeaders, ...rawAoA];
  const newSheet = XLSX.utils.aoa_to_sheet(aoaWithHeaders);

  return {
    headerRowNumber: 1,
    rows: XLSX.utils.sheet_to_json(newSheet, { defval: "", raw: true }),
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
  const unique = [
    ...new Set(codes.map(normalizeCommodityCode).filter(Boolean)),
  ];
  if (unique.length === 0) {
    return {};
  }

  await ensureCommodityCatalogTable(dbPool);

  const result = await dbPool.query(
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
  email: process.env.ADMIN_EMAIL || "shivampa345@gmail.com",
  full_name: "Local User",
  role: "admin",
};

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const passwordResetCodes = new Map();
const pendingUploadChunks = new Map();

const SUPER_ADMIN = {
  username: "6266782930",
  email: process.env.ADMIN_EMAIL || "shivampa345@gmail.com",
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
    mobile: user.mobile,
    first_name: user.first_name,
    last_name: user.last_name,
    category: user.category,
    auth_provider: user.auth_provider,
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
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fois-api", storage: getStorageStatus() });
});

// Auth routes
async function generateUniqueUsername(base) {
  const cleanBase = String(base || "user").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user";
  let candidate = cleanBase;
  let suffix = 1;
  while (await findUserByIdentifier(candidate)) {
    candidate = `${cleanBase}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const firstName = String(req.body?.firstName || req.body?.first_name || "").trim();
    const lastName = String(req.body?.lastName || req.body?.last_name || "").trim();
    const category = String(req.body?.category || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const mobile = String(req.body?.mobile || req.body?.phone || "").trim();
    const password = String(req.body?.password || "");

    if (!firstName || !lastName || !category || !password) {
      return res.status(400).json({ error: "firstName, lastName, category and password are required" });
    }
    // Fixed list plus a free-text "Other" category the user types themselves.
    if (!USER_CATEGORIES.includes(category) && category.length > 100) {
      return res.status(400).json({ error: "Category must be 100 characters or fewer" });
    }
    if (!email && !mobile) {
      return res.status(400).json({ error: "Provide either an email or a mobile number" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ error: "Enter a valid 10-digit mobile number" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    if (email && (await findUserByIdentifier(email))) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    if (mobile && (await findUserByIdentifier(mobile))) {
      return res.status(409).json({ error: "An account with this mobile number already exists" });
    }

    const username = await generateUniqueUsername(email ? email.split("@")[0] : mobile);
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await createUser({
      username,
      email: email || null,
      mobile: mobile || null,
      first_name: firstName,
      last_name: lastName,
      category,
      full_name: `${firstName} ${lastName}`.trim(),
      role: "user",
      password_hash: passwordHash,
    });

    return res.status(201).json(sanitizeUser(user));
  } catch (error) {
    next(error);
  }
});

// "Continue with Google" for both Login and Sign Up: the frontend obtains an
// ID token via Google Identity Services and hands it here. We verify it was
// really issued by Google for THIS app (aud === GOOGLE_CLIENT_ID) before
// trusting the email inside it, then find-or-create the matching account.
app.post("/api/auth/google", async (req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(501).json({ error: "Google Sign-In is not configured yet. Set GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_ID." });
    }
    const credential = String(req.body?.credential || "").trim();
    if (!credential) return res.status(400).json({ error: "Missing Google credential" });

    const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyResponse.ok) {
      return res.status(401).json({ error: "Invalid or expired Google credential" });
    }
    const payload = await verifyResponse.json();
    if (payload.aud !== clientId) {
      return res.status(401).json({ error: "Google credential was not issued for this app" });
    }
    if (payload.email_verified !== "true" && payload.email_verified !== true) {
      return res.status(401).json({ error: "Google account email is not verified" });
    }

    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Google account has no email" });

    let user = await findUserByIdentifier(email);
    if (!user) {
      const username = await generateUniqueUsername(email.split("@")[0]);
      const randomPassword = crypto.randomBytes(24).toString("hex");
      user = await createUser({
        username,
        email,
        first_name: payload.given_name || "",
        last_name: payload.family_name || "",
        full_name: payload.name || email,
        role: "user",
        password_hash: await bcrypt.hash(randomPassword, 10),
        auth_provider: "google",
      });
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
    const result = await pool.query(
      `SELECT id, code, name, active
         FROM state_master
         WHERE active IS NULL OR active = TRUE
         ORDER BY code ASC`
    );

    return res.json({ items: result.rows, count: result.rowCount });
  } catch (e) {
    return res
      .status(500)
      .json({ error: e?.message || "Failed to load states" });
  }
});

app.get("/api/masters/districts", requireAuth, async (req, res) => {
  try {
    const state = String(req.query.state || req.query.state_code || req.query.state_id || "").trim().toUpperCase();
    const result = await pool.query(
      `SELECT id, code, name, parent_code, active
       FROM district_master
       WHERE (active IS NULL OR active = TRUE)
         AND ($1::text = '' OR parent_code = $1)
       ORDER BY name ASC`,
      [state]
    );
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
      const result = await deleteUploadBatch(req.params.id);
      result.matching = await runMatchingEngine({
        requestedBy: req.auth?.username || "Admin",
        trigger: "batch-delete",
      });
      await invalidateCachePrefix("movement:");
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/admin/uploads/check-duplicate",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const fileHash = String(req.query.fileHash || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(fileHash)) {
        return res.status(400).json({ error: "A valid SHA-256 fileHash is required" });
      }
      const priorUploads = await listRecords("UploadLog", {
        filter: { file_hash: fileHash },
        limit: 1,
      });
      if (!priorUploads.length) return res.json({ duplicate: false });
      const prior = priorUploads[0];
      return res.status(409).json({
        error: `This Excel file is already uploaded as batch ${prior.batch_id} on ${prior.uploaded_at || prior.upload_time || prior.created_date}.`,
        duplicate: true,
        batch_id: prior.batch_id,
        uploaded_at: prior.uploaded_at || prior.upload_time || prior.created_date,
      });
    } catch (error) { next(error); }
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
      if (entry.size > 100 * 1024 * 1024) { pendingUploadChunks.delete(uploadId); return res.status(413).json({ error: "Excel file exceeds 100 MB" }); }
      pendingUploadChunks.set(uploadId, entry);
      const receivedCount = entry.chunks.reduce((count, chunk) => count + (Buffer.isBuffer(chunk) ? 1 : 0), 0);
      if (receivedCount !== total) return res.json({ success: true, received: receivedCount, total });

      const pendingZone = String(req.query.zone || "ALL").trim();
      pendingUploadChunks.delete(uploadId);
      const token = getAuthToken(req);
      const params = new URLSearchParams({ fileName, fileType, zone: pendingZone });
      const fullBuffer = Buffer.concat(entry.chunks);
      let upstream;
      try {
        upstream = await fetch(`http://127.0.0.1:${port}/api/admin/uploads/excel?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
          body: fullBuffer,
        });
      } catch {
        upstream = await fetch(`http://localhost:${port}/api/admin/uploads/excel?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
          body: fullBuffer,
        });
      }
      const payload = await upstream.json().catch(() => ({ error: "Upload processing failed" }));
      return res.status(upstream.status).json(payload);
    } catch (error) { next(error); }
  }
);

app.post(
  "/api/admin/uploads/excel/preview",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  express.raw({ type: "application/octet-stream", limit: "100mb" }),
  async (req, res, next) => {
    try {
      const isBinaryUpload = Buffer.isBuffer(req.body);
      const fileName = (isBinaryUpload ? req.query.fileName : req.body?.fileName) || "upload.xlsx";
      const fileType = (isBinaryUpload ? req.query.fileType : req.body?.fileType) || "ODR";
      const uploadSource = (isBinaryUpload ? req.query.source : req.body?.source) || "Excel";
      const selectedZone = String((isBinaryUpload ? req.query.zone : req.body?.zone) || "ALL").trim();
      const buffer = isBinaryUpload ? req.body : Buffer.from(String(req.body?.fileBase64 || ""), "base64");

      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
      if (sheetNames.length === 0) throw createClientUploadError("Workbook has no sheets");

      let parsedRecords = [];
      for (const sheetName of sheetNames) {
        const { rows: sheetRows } = sheetToFoisRows(workbook.Sheets[sheetName], fileType);
        if (!Array.isArray(sheetRows)) continue;
        let sheetParsed = [];
        if (fileType === "ODR") {
          sheetParsed = sheetRows.map((row, idx) => parseODRRow(row, "preview", idx + 1)).filter(Boolean);
        } else {
          sheetParsed = sheetRows.map((row, idx) => parseIndentRow(row, "preview", idx + 1)).filter(Boolean);
        }
        parsedRecords.push(...sheetParsed);
      }

      const rows_parsed = parsedRecords.length;
      let estimated_new = 0;
      let estimated_supplied_updates = 0;
      let estimated_matured_updates = 0;
      let estimated_updated = 0;
      let estimated_skipped = 0;
      let duplicate_rows_in_file = 0;

      const { deduplicateIntraFileRecords } = await import("./services/incrementalUploadEngine.js");
      const { uniqueRecords, duplicateRowsCount } = deduplicateIntraFileRecords(parsedRecords, fileType);
      duplicate_rows_in_file = duplicateRowsCount;

      if (fileType === "ODR") {
        const numbers = [...new Set(uniqueRecords.map((r) => r.odr_number).filter(Boolean))];
        const existingRows = numbers.length
          ? await pool.query(
              `SELECT data->>'odr_number' AS odr_number, data FROM freight_movements WHERE data->>'odr_number' = ANY($1::text[])`,
              [numbers]
            )
          : { rows: [] };
        const existingMap = new Map(existingRows.rows.map((r) => [r.odr_number, r]));

        for (const record of uniqueRecords) {
          const hasSupplied = Boolean(record.supplied_time || record.supplied_units > 0 || String(record.status).toLowerCase() === "supplied");
          const existing = existingMap.get(record.odr_number);
          if (existing) {
            if (hasSupplied) {
              estimated_supplied_updates++;
              estimated_updated++;
            } else {
              estimated_skipped++;
            }
          } else {
            estimated_new++;
            if (hasSupplied) estimated_supplied_updates++;
          }
        }
      } else {
        const numbers = [...new Set(uniqueRecords.map((r) => r.indent_number).filter(Boolean))];
        const existingRows = numbers.length
          ? await pool.query(
              `SELECT data->>'odr_number' AS odr_number, data FROM freight_movements WHERE data->>'odr_number' = ANY($1::text[])`,
              [numbers]
            )
          : { rows: [] };
        const existingMap = new Map(existingRows.rows.map((r) => [r.odr_number, r]));

        for (const record of uniqueRecords) {
          const existing = existingMap.get(record.indent_number);
          if (existing) {
            estimated_matured_updates++;
            estimated_updated++;
          } else {
            estimated_new++;
          }
        }
      }

      return res.json({
        success: true,
        detected_zone: selectedZone,
        next_version_number: 1,
        rows_parsed,
        estimated_new,
        estimated_supplied_updates,
        estimated_matured_updates,
        estimated_updated,
        estimated_skipped,
        duplicate_rows_in_file,
        warnings: [],
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
  express.raw({ type: "application/octet-stream", limit: "100mb" }),
  async (req, res, next) => {
    try {
      const isBinaryUpload = Buffer.isBuffer(req.body);
      const fileName = isBinaryUpload ? req.query.fileName : req.body?.fileName;
      const fileType = isBinaryUpload ? req.query.fileType : req.body?.fileType;
      const uploadSource = (isBinaryUpload ? req.query.source : req.body?.source) || "Excel";
      const selectedZone = String((isBinaryUpload ? req.query.zone : req.body?.zone) || "ALL").trim();
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
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      const priorUploads = await dbPool.query(
        `SELECT data FROM upload_logs
         WHERE data->>'file_hash' = $1
            OR (
              data->>'file_type' = $2
              AND data->>'zone' = $3
              AND (data->>'records_valid')::int > 0
              AND created_date > NOW() - INTERVAL '15 minutes'
            )
         ORDER BY created_date DESC LIMIT 1`,
        [fileHash, fileType, selectedZone]
      );
      if (priorUploads.rows.length > 0) {
        const prior = priorUploads.rows[0].data || {};
        return res.status(409).json({
          error: `This data batch was already uploaded as batch ${prior.batch_id} at ${prior.uploaded_at || prior.upload_time || prior.created_date}. Duplicate uploads are blocked.`,
          duplicate: true,
          batch_id: prior.batch_id,
          uploaded_at: prior.uploaded_at || prior.upload_time || prior.created_date,
        });
      }

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
              .map((row, idx) => parseODRRow(row, batchId, idx + 1))
              .filter(Boolean);
          } else {
            let firstRejectedIndentRow = null;
            let firstRejectedIndentReason = "";
            sheetParsed = [];

            for (let idx = 0; idx < sheetRows.length; idx++) {
              const row = sheetRows[idx];
              const parsed = parseIndentRow(row, batchId, idx + 1);
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
                row: firstRejectedIndentReason,
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
      let newIndentsAdded = 0;
      let suppliedStatusUpdates = 0;
      let maturedStatusUpdates = 0;

      const pool = dbPool;

      if (fileType === "ODR") {
        const aggregatedRecords = aggregateMultiLineIndents(parsedRecords, "ODR");

        const countMap = {};
        aggregatedRecords.forEach((record) => {
          const key = record.business_key || generateBusinessKey(record, "ODR");
          countMap[key] = (countMap[key] || 0) + 1;
        });

        const keysToQuery = aggregatedRecords.map(r => r.business_key || generateBusinessKey(r, "ODR")).filter(Boolean);
        const existingRows = keysToQuery.length
          ? await pool.query(
              `SELECT id, data, business_key FROM freight_movements WHERE business_key = ANY($1::text[]) OR (data->>'business_key') = ANY($1::text[])`,
              [keysToQuery]
            )
          : { rows: [] };

        const existingMap = new Map();
        existingRows.rows.forEach((row) => {
          const bKey = row.business_key || row.data?.business_key || generateBusinessKey(row.data, "ODR");
          existingMap.set(bKey, row);
        });

        const toUpdateODR = [];
        const notifsToPush = [];
        const toInsert = [];

        for (const record of aggregatedRecords) {
          const key = record.business_key || generateBusinessKey(record, "ODR");
          const existing = existingMap.get(key);
          const hasSuppliedState = Boolean(record.supplied_time || (record.supplied_units && Number(record.supplied_units) > 0));

          if (existing) {
            const prevSuppliedUnits = Number(existing.data.supplied_units || 0);
            const prevSuppliedTime = String(existing.data.supplied_time || "").trim();
            const currSuppliedUnits = Number(record.supplied_units || 0);
            const currSuppliedTime = String(record.supplied_time || "").trim();

            const isSupplyChanged = hasSuppliedState && (
              currSuppliedUnits !== prevSuppliedUnits ||
              (currSuppliedTime && currSuppliedTime !== prevSuppliedTime)
            );

            const updatedStatus = existing.data.status === "Matured" || existing.data.status === "Dispatched"
              ? existing.data.status
              : (hasSuppliedState || isSupplyChanged ? "Supplied" : (existing.data.status || "Indent"));

            const mergedRawData = { ...existing.data.raw_data, ...record.raw_data };
            const mergedLineItems = record.line_items || existing.data.line_items || [];

            const updatedData = {
              ...existing.data,
              business_key: key,
              unique_rake_code: formatUniqueRakeCode(key),
              status: updatedStatus,
              supplied_time: currSuppliedTime || prevSuppliedTime,
              supplied_units: currSuppliedUnits > 0 ? currSuppliedUnits : prevSuppliedUnits,
              wagons: Math.max(Number(existing.data.wagons || 0), currSuppliedUnits, Number(record.indented_units || 0)),
              indented_units: record.indented_units || existing.data.indented_units,
              line_items: mergedLineItems,
              raw_data: mergedRawData,
              updated_at: new Date().toISOString(),
            };

            toUpdateODR.push({ id: existing.id, data: updatedData });

            if (isSupplyChanged) {
              suppliedStatusUpdates++;
              notifsToPush.push({
                movement_reference: `DEMAND:${key}:RackSupplied:${updatedData.supplied_units}:${updatedData.supplied_time}`,
                station_code: updatedData.station_from || record.station_from,
                notification_type: "RackSupplied",
                type: record.movement_type || "Outward",
                title: `🚚 Rack Supplied: ${updatedData.unique_rake_code || `#${record.odr_number || ""}`}`,
                message: `🔖 Rake ID: ${updatedData.unique_rake_code || "-"}\n📍 Station: ${updatedData.station_from || "-"}\nCommodity: ${updatedData.commodity || "-"}\nSupplied: ${updatedData.supplied_units} / ${updatedData.indented_units || "-"} Units\nSupply Date: ${updatedData.supplied_time || "-"}`,
                severity: "info",
                related_odr: record.odr_number,
                related_division: updatedData.division,
                batch_id: batchId,
                data: { movement: updatedData },
              });
            }
            updatedRecords++;
          } else {
            record.business_key = key;
            record.unique_rake_code = formatUniqueRakeCode(key);
            record.is_duplicate = countMap[key] > 1;
            if (record.is_duplicate) {
              duplicatesFound++;
            } else {
              newIndentsAdded++;
              const initialStatus = hasSuppliedState ? "Supplied" : "Indent";
              record.status = initialStatus;

              if (hasSuppliedState) {
                suppliedStatusUpdates++;
              }

              // Stage 1 Notification: New Rack Indent
              notifsToPush.push({
                movement_reference: `DEMAND:${key}:NewRackIndent`,
                station_code: record.station_from,
                notification_type: "NewRackIndent",
                type: record.movement_type || "Outward",
                title: `📝 New Rack Indent: ${record.unique_rake_code || `#${record.odr_number || ""}`}`,
                message: `🔖 Rake ID: ${record.unique_rake_code || "-"}\n📍 Station: ${record.station_from || "-"}\nCommodity: ${record.commodity || "-"}\nDestination: ${record.station_to || "-"}\nUnits: ${record.indented_units || "-"} Units`,
                severity: "info",
                related_odr: record.odr_number,
                related_division: record.division,
                batch_id: batchId,
                data: { movement: record },
              });

              if (hasSuppliedState) {
                // Also trigger supply notification if initial upload already contains supply details
                notifsToPush.push({
                  movement_reference: `DEMAND:${key}:RackSupplied:${record.supplied_units}:${record.supplied_time}`,
                  station_code: record.station_from,
                  notification_type: "RackSupplied",
                  type: record.movement_type || "Outward",
                  title: `🚚 Rack Supplied: ${record.unique_rake_code || `#${record.odr_number || ""}`}`,
                  message: `🔖 Rake ID: ${record.unique_rake_code || "-"}\n📍 Station: ${record.station_from || "-"}\nCommodity: ${record.commodity || "-"}\nSupplied: ${record.supplied_units} / ${record.indented_units || "-"} Units`,
                  severity: "info",
                  related_odr: record.odr_number,
                  related_division: record.division,
                  batch_id: batchId,
                  data: { movement: record },
                });
              }

              toInsert.push(record);
            }
          }
        }

        if (toUpdateODR.length > 0) {
          const chunkSize = 500;
          for (let i = 0; i < toUpdateODR.length; i += chunkSize) {
            const chunk = toUpdateODR.slice(i, i + chunkSize);
            const values = [];
            const placeholders = chunk.map((item, idx) => {
              const offset = idx * 2;
              values.push(String(item.id), item.data);
              return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
            });
            await pool.query(
              `UPDATE freight_movements SET data = v.data, updated_date = NOW()
               FROM (VALUES ${placeholders.join(",")}) AS v(id, data)
               WHERE freight_movements.id = v.id`,
              values
            );
          }
        }

        if (toInsert.length > 0) {
          await createRecords("FreightMovement", toInsert);
          insertedRecords = toInsert.length;
        }

        // Fire notifications in background
        Promise.all(notifsToPush.map((n) => createNotification(n).catch(() => undefined))).catch(() => undefined);

        await invalidateCachePrefix("movement:");

      } else {
        // MaturedIndent upload: match existing FreightMovement by exact 6-tuple Business Key
        const aggregatedMatured = aggregateMultiLineIndents(parsedRecords, "MaturedIndent");
        const keysToMatch = aggregatedMatured.map(r => generateBusinessKey(r, "MaturedIndent")).filter(Boolean);

        const existingMovements = keysToMatch.length
          ? await pool.query(
              `SELECT id, data, business_key FROM freight_movements WHERE business_key = ANY($1::text[]) OR (data->>'business_key') = ANY($1::text[])`,
              [keysToMatch]
            )
          : { rows: [] };

        const movementMap = new Map();
        existingMovements.rows.forEach((row) => {
          const bKey = row.business_key || row.data?.business_key || generateBusinessKey(row.data, "ODR");
          movementMap.set(bKey, row);
        });

        const toUpdateMatured = [];
        const maturedNotifs = [];

        for (const record of aggregatedMatured) {
          const key = generateBusinessKey(record, "MaturedIndent");
          const match = movementMap.get(key);

          // Must come ONLY from an actual "MET WITH DATE" value. record.maturity_date
          // falls back to the expected loading date when no real MET WITH DATE exists
          // (see parseIndentRow), so it is NOT proof of maturity and must never be used
          // here - that fallback previously caused nearly every matched rack to be
          // marked "Matured" the moment any Matured Indent row referenced it.
          const metWithDate = record.met_with_date || record.raw_data?.['MET WITH DATE'] || record.raw_data?.['METWITH DATE'] || record.raw_data?.['met_with_date'] || "";
          const hasMetWithDate = Boolean(metWithDate && String(metWithDate).trim() !== "" && String(metWithDate).trim() !== "-");

          if (match) {
            record.odr_matched = true;
            record.matched_odr_number = record.indent_number;

            const updatedStatus = hasMetWithDate ? "Matured" : (match.data.status || "Indent");
            const mergedRawData = { ...match.data.raw_data, ...record.raw_data, 'MET WITH DATE': metWithDate };

            const existingSupplied = parseInt(match.data.supplied_units, 10) || 0;
            const maturedUnits = parseInt(record.wagons_demanded || record.indented_units || record.supplied_units, 10) || 0;
            const finalSuppliedUnits = existingSupplied > 0 ? existingSupplied : maturedUnits;

            const updatedData = {
              ...match.data,
              business_key: key,
              unique_rake_code: formatUniqueRakeCode(key),
              status: updatedStatus,
              matured_date: metWithDate || match.data.matured_date,
              met_with_date: metWithDate || match.data.met_with_date,
              indented_units: match.data.indented_units || record.indented_units || record.wagons_demanded,
              supplied_units: finalSuppliedUnits,
              supplied_time: match.data.supplied_time || metWithDate || "",
              raw_data: mergedRawData,
              updated_at: new Date().toISOString(),
            };

            toUpdateMatured.push({ id: match.id, data: updatedData });

            if (hasMetWithDate) {
              maturedStatusUpdates++;
              maturedNotifs.push({
                movement_reference: `DEMAND:${key}:RackDispatched:${metWithDate}`,
                station_code: updatedData.station_from || record.station_from,
                notification_type: "RackDispatched",
                type: record.movement_type || "Outward",
                title: `🚆 Rack Matured / Dispatched: ${updatedData.unique_rake_code || `#${record.indent_number || ""}`}`,
                message: `🔖 Rake ID: ${updatedData.unique_rake_code || "-"}\n📍 Station: ${updatedData.station_from || "-"}\nDestination: ${updatedData.station_to || "-"}\nMatured & Dispatched Date: ${metWithDate}`,
                severity: "success",
                related_odr: record.indent_number,
                related_division: updatedData.division,
                batch_id: batchId,
                data: { movement: updatedData },
              });
            }
            updatedRecords++;
          }
        }

        if (toUpdateMatured.length > 0) {
          const chunkSize = 500;
          for (let i = 0; i < toUpdateMatured.length; i += chunkSize) {
            const chunk = toUpdateMatured.slice(i, i + chunkSize);
            const values = [];
            const placeholders = chunk.map((item, idx) => {
              const offset = idx * 2;
              values.push(String(item.id), item.data);
              return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
            });
            await pool.query(
              `UPDATE freight_movements SET data = v.data, updated_date = NOW()
               FROM (VALUES ${placeholders.join(",")}) AS v(id, data)
               WHERE freight_movements.id = v.id`,
              values
            );
          }
        }

        // Fire notifications in background
        Promise.all(maturedNotifs.map((n) => createNotification(n).catch(() => undefined))).catch(() => undefined);

        // Check existing MaturedIndents in DB to prevent duplicate rows in matured_indents table
        const existingIndentsInDb = keysToMatch.length
          ? await pool.query(
              `SELECT id, data, business_key FROM matured_indents WHERE business_key = ANY($1::text[]) OR (data->>'business_key') = ANY($1::text[])`,
              [keysToMatch]
            )
          : { rows: [] };

        const existingIndentMap = new Map();
        existingIndentsInDb.rows.forEach((row) => {
          const bKey = row.business_key || row.data?.business_key || generateBusinessKey(row.data, "MaturedIndent");
          existingIndentMap.set(bKey, row);
        });

        const indentsToInsert = [];
        for (const record of aggregatedMatured) {
          const key = record.business_key || generateBusinessKey(record, "MaturedIndent");
          const existingIndent = existingIndentMap.get(key);
          if (existingIndent) {
            duplicatesFound++;
          } else {
            record.business_key = key;
            record.unique_rake_code = formatUniqueRakeCode(key);
            indentsToInsert.push(record);
            newIndentsAdded++;
          }
        }

        if (indentsToInsert.length > 0) {
          await createRecords("MaturedIndent", indentsToInsert);
          insertedRecords = indentsToInsert.length;
        } else {
          insertedRecords = 0;
        }

        await invalidateCachePrefix("movement:");
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
        s.updatedRows = updatedRecords;
      }

      const uploadTime = new Date().toISOString();
      const uploadStatus =
        processedSheets > 0
          ? failedSheets > 0
            ? "Partial"
            : "Completed"
          : "Failed";
      const { version_number } = await getNextUploadVersion(fileType, selectedZone).catch(() => ({ version_number: 1 }));

      const logEntry = {
        batch_id: batchId,
        original_file_name: fileName,
        file_name: fileName,
        file_type: fileType,
        source: uploadSource,
        file_hash: fileHash,
        uploaded_by: req.auth?.username || "Admin",
        uploaded_at: uploadTime,
        record_count: insertedRecords,
        records_parsed: recordsParsed,
        records_valid: recordsValid,
        records_failed: recordsFailed,
        version_number,
        totalSheets,
        processedSheets,
        failedSheets,
        insertedRecords,
        updatedRecords,
        skippedRecords: Math.max(0, recordsValid - (insertedRecords + updatedRecords)),
        new_indents_added: newIndentsAdded,
        supplied_status_updates: suppliedStatusUpdates,
        matured_status_updates: maturedStatusUpdates,
        sheetWiseStats,
        duplicates_found: duplicatesFound,
        real_added: Math.max(0, recordsValid - duplicatesFound),
        missing_odrs_found: missingODRs,
        status: uploadStatus,
        upload_time: uploadTime,
        zone: selectedZone,
      };

      const savedUploadLog = await createRecord("UploadLog", logEntry);

      // Trigger matching engine in the background asynchronously so the HTTP request completes immediately
      runMatchingEngine({
        requestedBy: req.auth?.username || "Admin",
        trigger: fileType === "ODR" ? "odr-upload" : "matured-upload",
      })
        .then(async (matching) => {
          const mMissing = matching.unmatched_matured || 0;
          let mMatured = maturedStatusUpdates;
          let mUpdated = updatedRecords;
          if (fileType === "MaturedIndent" && matching.matched > 0) {
            mMatured += Number(matching.matched || 0);
            mUpdated += Number(matching.matched || 0);
          }
          await updateRecord("UploadLog", savedUploadLog.id, {
            missing_odrs_found: mMissing,
            matured_status_updates: mMatured,
            updatedRecords: mUpdated,
            matching,
          }).catch((e) => console.error("[Upload] UploadLog update error:", e?.message));
        })
        .catch((e) => console.error("[Upload] Background matching engine error:", e?.message));

      return res.status(201).json({
        success: true,
        ...logEntry,
        matching: { status: "Processing in background" },
        message: `Successfully processed ${processedSheets}/${totalSheets} sheet(s). Total valid records: ${parsedRecords.length}. Matching engine is running in background.`,
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
          duplicates_found: 0,
          real_added: 0,
          status: "Failed",
          error_details: error.message,
          upload_time: uploadTime,
        }).catch(() => undefined);
      }
      next(error);
    }
  }
);

app.get(
  "/api/admin/matching/summary",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (_req, res, next) => {
    try {
      res.json(await getMatchingSummary());
    } catch (error) { next(error); }
  }
);

app.use("/api/admin/comparison", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

app.get("/api/admin/comparison/summary", requireAuth, requireRoles(ADMIN_ROLES), async (_req, res, next) => {
  try {
    const value = await getMatchingSummary();
    res.json({
      total_odr: value.total_odr || 0,
      total_matured: value.total_matured || 0,
      matched: value.matched || 0,
      pending_odr: value.pending || 0,
      unmatched_matured: value.unmatched_matured || 0,
      partial_matches: value.partial || 0,
      manual_review: value.manual_review || 0,
      duplicate_odr: value.duplicate_odr || 0,
      duplicate_matured: value.duplicate_matured || 0,
      completed_supply: value.completed || 0,
      last_matching_run: value.last_matching_run || null,
      matching_duration_ms: value.matching_duration || 0,
      pending: value.pending || 0,
      partial: value.partial || 0,
      completed: value.completed || 0,
      matching_duration: value.matching_duration || 0,
    });
  } catch (error) { next(error); }
});

app.get("/api/admin/comparison/records", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const result = await comparisonRecords(req.query, {
      page: req.query.page,
      limit: req.query.page_size || req.query.limit,
    });
    const records = result.items.map((row) => ({
      comparison_id: row.match_id, odr_id: row.odr_id, matured_id: row.matured_id,
      odr_number: row.odr?.odr_number || null,
      matured_indent_number: row.matured?.indent_number || null,
      division: row.odr?.division || null, station_from: row.odr?.station_from || null,
      destination: row.odr?.station_to || null, state: row.source_state || null,
      district: row.source_district || null,
      company: row.odr?.company || row.odr?.company_code || null,
      cnsg: row.odr?.raw_data?.cnsg || null, commodity: row.odr?.commodity || null,
      rake_cmdt: row.odr?.rake_cmdt || row.odr?.rake_commodity_code || null,
      demand_date: row.odr?.departure_date || null,
      indented_units: row.indented_units, supplied_units: row.supplied_units,
      balance_units: row.balance_units, status: row.status,
      confidence: Number(row.confidence || 0), match_method: row.match_method,
      odr_batch_id: row.batch_odr, matured_batch_id: row.batch_matured,
      matched_on: row.matched_on, resolution_note: row.resolution_note,
    }));
    res.json({
      records,
      items: result.items,
      page: result.page,
      page_size: result.limit,
      limit: result.limit,
      total: result.total,
      total_pages: Math.ceil(result.total / result.limit),
    });
  } catch (error) { next(error); }
});

app.get("/api/admin/comparison/filters", requireAuth, requireRoles(ADMIN_ROLES), async (_req, res, next) => {
  try { res.json(await comparisonFilterOptions()); } catch (error) { next(error); }
});

app.get("/api/admin/comparison/options", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try { res.json(await comparisonFilterOptions({ state: String(req.query.state || "") })); } catch (error) { next(error); }
});

app.get("/api/admin/comparison/analytics", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try { res.json(await comparisonAnalytics(req.query)); } catch (error) { next(error); }
});

app.get("/api/admin/comparison/runs", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const items = (await matchingRuns({ limit: req.query.limit })).map((run) => ({
      ...run,
      manual_review: run.ambiguous,
      duplicates: run.duplicate_count,
    }));
    res.json({ items, runs: items });
  } catch (error) { next(error); }
});

app.get("/api/admin/comparison/rules", requireAuth, requireRoles(ADMIN_ROLES), async (_req, res, next) => {
  try { res.json(await getRules()); } catch (error) { next(error); }
});

app.put("/api/admin/comparison/rules", requireAuth, requireRoles(["super_admin"]), async (req, res, next) => {
  try { res.json(await saveRules(req.body || {}, req.auth?.username || "Super Admin")); } catch (error) { next(error); }
});

app.get("/api/admin/comparison/:id", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    if (req.params.id === "export.xlsx") return next();
    const detail = await comparisonDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Comparison record not found" });
    res.json(detail);
  } catch (error) { next(error); }
});

app.post("/api/admin/comparison/reprocess", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const payload = req.body || {};
    const summary = await runMatchingEngine({
      requestedBy: req.auth?.username || "Admin",
      trigger: "manual-reprocess",
      scope: typeof payload.scope === "string" ? { type: payload.scope } : payload.scope || { type: "all" },
      resetManualDecisions: Boolean(payload.reset_manual_decisions && req.auth?.role === "super_admin"),
    });
    res.json({
      run_id: summary.run_id, status: "completed",
      odr_scanned: summary.total_odr, matured_scanned: summary.total_matured,
      matched: summary.matched + summary.completed, pending: summary.pending,
      partial: summary.partial, manual_review: summary.manual_review,
      duplicates: summary.duplicates, duration_ms: summary.elapsed_ms,
      ...summary,
    });
  } catch (error) { next(error); }
});

app.post("/api/admin/comparison/:id/reprocess", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const detail = await comparisonDetail(req.params.id);
    if (!detail?.odr_id) return res.status(404).json({ error: "Comparison record not found" });
    res.json(await runMatchingEngine({
      requestedBy: req.auth?.username || "Admin",
      trigger: "record-reprocess",
      scope: { type: "record", odr_id: detail.odr_id },
    }));
  } catch (error) { next(error); }
});

app.post("/api/admin/comparison/:id/resolve", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    if (!req.body?.matured_id) return res.status(400).json({ error: "matured_id is required" });
    res.json(await resolveComparison(req.params.id, {
      matured_id: String(req.body.matured_id),
      note: String(req.body.resolution_note || req.body.note || ""),
      resolvedBy: req.auth?.username || "Admin",
    }));
  } catch (error) { next(error); }
});

app.post("/api/admin/comparison/:id/unmatch", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await unmatchComparison(req.params.id, {
      note: String(req.body?.resolution_note || req.body?.note || ""),
      resolvedBy: req.auth?.username || "Admin",
    }));
  } catch (error) { next(error); }
});

app.post("/api/admin/comparison/reset-manual-decisions", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const count = await pool.query("SELECT COUNT(*)::int affected FROM odr_matured_matches WHERE manual_locked=TRUE");
    const matching = await runMatchingEngine({
      requestedBy: req.auth?.username || "Admin",
      trigger: "reset-manual-decisions",
      scope: { type: "all" },
      resetManualDecisions: true,
    });
    res.json({ success: true, affected_count: count.rows[0].affected, reset_by: req.auth?.username, matching });
  } catch (error) { next(error); }
});

app.get("/api/admin/comparison/export.xlsx", requireAuth, requireRoles(ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = await comparisonRecords(req.query, { page: 1, limit: 50000, maxLimit: 50000 });
    const rows = data.items.map((row) => ({
      "ODR Number": row.odr?.odr_number || "", Division: row.odr?.division || "",
      "Station From": row.odr?.station_from || "", Destination: row.odr?.station_to || "",
      Company: row.odr?.company || row.odr?.company_code || "", CNSG: row.odr?.raw_data?.cnsg || "",
      Commodity: row.odr?.commodity || "", "Rake CMDT": row.odr?.rake_cmdt || row.odr?.rake_commodity_code || "",
      "Demand Date": row.odr?.departure_date || "", "Indented Units": row.indented_units,
      "Supplied Units": row.supplied_units, "Balance Units": row.balance_units,
      "Matured Indent": row.matured?.indent_number || "", Status: row.status,
      Confidence: Number(row.confidence || 0), "Match Method": row.match_method,
      "ODR Batch": row.batch_odr || "", "Matured Batch": row.batch_matured || "",
      "Matched On": row.matched_on || "",
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Comparison");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="ODR_Matured_Comparison.xlsx"');
    res.send(buffer);
  } catch (error) { next(error); }
});

app.get("/api/user/freight-status/summary", requireAuth, async (req, res, next) => {
  try { res.json(await userFreightSummary(req.auth, req.query)); } catch (error) { next(error); }
});

app.get("/api/user/freight-status/records", requireAuth, async (req, res, next) => {
  try { res.json(await userFreightRecords(req.auth, req.query, { page: req.query.page, limit: req.query.limit })); } catch (error) { next(error); }
});

app.get("/api/user/freight-status/analytics", requireAuth, async (req, res, next) => {
  try { res.json(await comparisonAnalytics(req.query, req.auth)); } catch (error) { next(error); }
});

app.get("/api/user/freight-status-export.xlsx", requireAuth, async (req, res, next) => {
  try {
    const data = await userFreightRecords(req.auth, req.query, { page: 1, limit: 50000, maxLimit: 50000 });
    const rows = data.items.map((row) => ({
      "Demand No.": row.odr?.odr_number || "", Division: row.odr?.division || "",
      "Source Station": row.odr?.station_from || "", Destination: row.odr?.station_to || "",
      Company: row.odr?.company || row.odr?.company_code || "", Commodity: row.odr?.commodity || "",
      "Rake CMDT": row.odr?.rake_cmdt || row.odr?.rake_commodity_code || "",
      "Demand Date": row.odr?.departure_date || "", "Indented Units": row.indented_units,
      "Supplied Units": row.supplied_units, "Balance Units": row.balance_units,
      Status: row.status, "Last Updated": row.updated_date || "",
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Freight Status");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="My_Freight_Status.xlsx"');
    res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  } catch (error) { next(error); }
});

app.get("/api/user/freight-status/:id/timeline", requireAuth, async (req, res, next) => {
  try {
    const timeline = await userTimeline(req.auth, req.params.id);
    if (!timeline) return res.status(404).json({ error: "Freight record not found" });
    res.json(timeline);
  } catch (error) { next(error); }
});

app.get(
  "/api/admin/matching/results",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      res.json(await listMatchingResults({
        page: req.query.page,
        limit: req.query.limit,
        status: String(req.query.status || ""),
        search: String(req.query.search || ""),
      }));
    } catch (error) { next(error); }
  }
);

app.post(
  "/api/admin/matching/reprocess",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const summary = await runMatchingEngine({
        requestedBy: req.auth?.username || "Admin",
        trigger: "manual-reprocess",
      });
      await invalidateCachePrefix("movement:");
      res.json({ success: true, ...summary });
    } catch (error) { next(error); }
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
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = (page - 1) * limit;
    const visibleTypes = ["Inward", "Outward"];
    const rows = await listRecords("RailNotification", {
      filter: { type: visibleTypes },
      sort: "-created_date",
      limit: limit + 1,
      offset,
    });
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    res.json({
      items: pageRows.map((item) => ({ ...item, is_read: (item.read_by || []).includes(userId) })),
      page,
      limit,
      hasMore,
    });
  } catch (error) { next(error); }
});

app.post("/api/notifications/mark-all-read", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.auth?.id || req.auth?.sub || "");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const updated = await markAllNotificationsRead(userId);
    res.json({ success: true, updated });
  } catch (error) { next(error); }
});

app.post("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.auth?.id || req.auth?.sub || "");
    const rows = await listRecords("RailNotification", { filter: { id: req.params.id }, limit: 1 });
    const item = rows[0];
    const allowedTypes = ADMIN_ROLES.includes(req.auth?.role)
      ? ["inward", "outward", "adminreview"]
      : ["inward", "outward"];
    if (!item || !allowedTypes.includes(String(item.type || "").toLowerCase())) return res.status(404).json({ error: "Notification not found" });
    const readBy = [...new Set([...(Array.isArray(item.read_by) ? item.read_by : []), userId])];
    await updateRecord("RailNotification", item.id, { read_by: readBy });
    res.json({ success: true });
  } catch (error) { next(error); }
});

function movementQueryFromRequest(req) {
  const multi = (name) => req.query[name]
    ? String(req.query[name]).split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  return {
    direction: req.query.direction,
    zone: multi("zone"), division: multi("division"), state: multi("state"),
    district: multi("district"), station: multi("station"), commodity: multi("commodity"),
    rake: multi("rake"), company: multi("company"), cnsr: multi("cnsr"), cnsg: multi("cnsg"),
    search: req.query.search,
    status: req.query.status,
    page: req.query.page, limit: req.query.limit,
  };
}

app.get("/api/movements/dashboard-summary", requireAuth, async (req, res, next) => {
  try {
    res.set("Cache-Control", "private, max-age=30");
    res.json(await movementDashboardSummary(movementQueryFromRequest(req)));
  } catch (error) { next(error); }
});

app.get("/api/movements", requireAuth, async (req, res, next) => {
  try { res.json(await pagedMovements(movementQueryFromRequest(req))); }
  catch (error) { next(error); }
});

app.get("/api/fois-reports", requireAuth, async (req, res, next) => {
  try {
    res.json(await pagedFoisReports({
      page: req.query.page, limit: req.query.limit, search: req.query.search,
      zone: req.query.zone ? String(req.query.zone).split(",") : [],
      division: req.query.division ? String(req.query.division).split(",") : [],
      state: req.query.state ? String(req.query.state).split(",") : [],
      district: req.query.district ? String(req.query.district).split(",") : [],
      stationFrom: req.query.stationFrom ? String(req.query.stationFrom).split(",") : [],
      commodity: req.query.commodity ? String(req.query.commodity).split(",") : [],
      rake: req.query.rake ? String(req.query.rake).split(",") : [],
      cnsr: req.query.cnsr ? String(req.query.cnsr).split(",") : [],
      cnsg: req.query.cnsg ? String(req.query.cnsg).split(",") : [],
      destination: req.query.destination ? String(req.query.destination).split(",") : [],
      unmappedOnly: req.query.unmappedOnly === "true",
      status: req.query.status,
    }));
  } catch (error) { next(error); }
});

app.get("/api/filter-hierarchy", requireAuth, async (req, res, next) => {
  try { res.json(await filterHierarchy(req.query.direction)); } catch (error) { next(error); }
});

app.get("/api/masters/unmapped-summary", requireAuth, async (_req, res, next) => {
  try { res.json(await unmappedSummary()); } catch (error) { next(error); }
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
      if (req.params.entityName === "FreightMovement") await invalidateCachePrefix("movement:");
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

    try {
      const normalizedCode = String(code).trim().toUpperCase();
      const normalizedName = String(name).trim();

      const checkExist = await pool.query(
        "SELECT id FROM state_master WHERE UPPER(code) = $1 LIMIT 1",
        [normalizedCode]
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "State with this code already exists" });
      }

      const maxRes = await pool.query("SELECT id FROM state_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      // NOTE: verified schema from container: state_master has (id TEXT, code TEXT, name TEXT, parent_code TEXT?, active BOOLEAN?)
      // mastersController elsewhere uses (id, code, name, active, parent_code). Here we insert minimal columns.
      const result = await pool.query(
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
    }
  }
);

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
      const normalizedName = String(name).trim();
      const calculatedCode = code
        ? String(code).trim().toUpperCase()
        : normalizedName.slice(0, 3).toUpperCase();

      // Resolve state reference column: state_id/stateId/state or just accept whatever exists.
      const distSample = await pool.query(
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


      const checkExist = await pool.query(
        debug.checkExist.sql,
        debug.checkExist.params
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "District already exists in this state" });
      }

      const maxRes = await pool.query("SELECT id FROM district_master");
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


      const result = await pool.query(
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

    try {
      await ensureCommodityCatalogTable(pool);

      const normalizedCode = String(code).trim().toUpperCase();
      const normalizedName = String(full_name).trim();

      const checkExist = await pool.query(
        "SELECT id FROM commodity_master WHERE UPPER(code) = $1 AND type = $2 LIMIT 1",
        [normalizedCode, type]
      );

      if (checkExist.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "Code already registered for this type" });
      }

      const maxRes = await pool.query("SELECT id FROM commodity_master");
      let nextId = 1;
      if (maxRes.rows.length > 0) {
        const ids = maxRes.rows
          .map((r) => parseInt(r.id, 10))
          .filter((id) => !Number.isNaN(id));
        if (ids.length > 0) nextId = Math.max(...ids) + 1;
      }

      const result = await pool.query(
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
  return callback(pool);
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

function normalizeStateMasterCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return { TG: "TS", OR: "OD", DH: "DD" }[normalized] || normalized;
}

async function requireMasterReference(pool, tableName, code, label) {
  const rawCode = String(code || "").trim().toUpperCase();
  const normalized =
    tableName === "state_master"
      ? normalizeStateMasterCode(rawCode)
      : rawCode;
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

async function requireDistrictReference(_pool, stateCode, districtCode) {
  const state = String(stateCode || "").trim().toUpperCase();
  const district = String(districtCode || "").trim();
  if (!state) throw new Error("State is required");
  if (!district) throw new Error("District is required");

  // Station workbooks use the legacy "DistrictCode" header for a full
  // district name. The district catalog is not exhaustive, so requiring an
  // exact catalog code/name here rejects otherwise valid station records.
  return district;
}

async function requireDivisionReference(pool, zoneCode, divisionCode) {
  const zone = String(zoneCode || "").trim().toUpperCase();
  const division = String(divisionCode || "").trim().toUpperCase();
  if (!zone) throw new Error("Zone is required");
  if (!division) throw new Error("Division is required");

  // Preserve valid source division codes even when the local division catalog
  // has not been populated with that code yet. Zone validity is checked by
  // requireMasterReference before this function is called.
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
        let parentCode = body.parent_code ? String(body.parent_code).trim().toUpperCase() : null;
        const generatedDistrictCode = masterKey === "district"
          ? `${parentCode}_${name}`.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()
          : "";
        const code = String(body.code || generatedDistrictCode).trim().toUpperCase();
        if (!code || !name) throw new Error(masterKey === "district" ? "District name is required" : `${config.label} code and name are required`);
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

app.post(
  "/api/masters/catalog/district/bulk",
  requireAuth,
  requireRoles(ADMIN_ROLES),
  async (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (records.length === 0 || records.length > 5000) {
      return res.status(400).json({ error: "Provide between 1 and 5000 district records" });
    }

    try {
      const result = await withCatalogPool(async (pool) => {
        await ensureCatalogTable(pool, MASTER_CATALOGS.district);
        const normalized = records.map((record, index) => {
          const parentCode = normalizeStateMasterCode(record?.parent_code);
          const name = String(record?.name || "").trim();
          if (!parentCode || !name) throw new Error(`Row ${index + 1}: StateCode and DistrictName are required`);
          const code = `${parentCode}_${name}`
            .replace(/[^A-Za-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toUpperCase();
          return { id: catalogId("district_master", code), code, name, parentCode };
        });

        const stateCodes = [...new Set(normalized.map((record) => record.parentCode))];
        const states = await pool.query(
          `SELECT code FROM state_master WHERE code = ANY($1::text[])`,
          [stateCodes]
        );
        const existingStates = new Set(states.rows.map((row) => row.code));
        const missingStates = stateCodes.filter((code) => !existingStates.has(code));
        if (missingStates.length) throw new Error(`Parent State not found: ${missingStates.join(", ")}`);

        const existingDistricts = await pool.query(
          `SELECT id, code, name, parent_code
           FROM district_master
           WHERE parent_code = ANY($1::text[])`,
          [stateCodes]
        );
        const existingById = new Map(
          existingDistricts.rows.map((row) => [row.id, row])
        );
        const existingByStateAndName = new Map(
          existingDistricts.rows.map((row) => [
            `${row.parent_code}|${String(row.name || "").trim().toLocaleLowerCase("en-IN")}`,
            row,
          ])
        );
        const resolved = normalized.map((record) => {
          const existing =
            existingById.get(record.id) ||
            existingByStateAndName.get(
              `${record.parentCode}|${record.name.toLocaleLowerCase("en-IN")}`
            );
          return existing
            ? { ...record, id: existing.id, code: existing.code }
            : record;
        });

        const params = [];
        const values = resolved.map((record) => {
          const start = params.length + 1;
          params.push(record.id, record.code, record.name, record.parentCode);
          return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, TRUE, NOW(), NOW())`;
        });
        const inserted = await pool.query(
          `INSERT INTO district_master (id, code, name, parent_code, active, created_at, updated_at)
           VALUES ${values.join(",")}
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             parent_code = EXCLUDED.parent_code,
             active = TRUE,
             updated_at = NOW()
           RETURNING id`,
          params
        );
        return inserted.rowCount;
      });
      return res.status(201).json({ imported: result, failed: 0 });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "District bulk import failed" });
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
if (getStorageStatus().postgres) {
  await ensureMatchingSchema();
  const initialComparison = await getMatchingSummary();
  const persistedComparisonCount = [
    initialComparison.matched, initialComparison.pending, initialComparison.partial,
    initialComparison.completed, initialComparison.duplicate,
    initialComparison.manual_review, initialComparison.unmatched_matured,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  if (Number(initialComparison.total_odr || 0) + Number(initialComparison.total_matured || 0) > 0 && persistedComparisonCount === 0) {
    await runMatchingEngine({
      requestedBy: "System startup",
      trigger: "initial-safe-reprocess",
      scope: { type: "all" },
    });
  }
}
await ensureSuperAdminExists(SUPER_ADMIN);
await autoSeedMastersIfEmpty();

async function autoSeedMastersIfEmpty() {
  try {
    await ensureGenericMasterTable(pool, "state_master");
    await ensureGenericMasterTable(pool, "district_master");
    await ensureGenericMasterTable(pool, "zone_master");
    await ensureGenericMasterTable(pool, "division_master");

    const stateCount = await pool.query("SELECT COUNT(*)::int AS count FROM state_master");
    if ((stateCount.rows[0]?.count || 0) === 0) {
      console.log("[Startup] state_master is empty, running state/district seeder...");
      await runSeeder(pool);
    }

    const zoneCount = await pool.query("SELECT COUNT(*)::int AS count FROM zone_master");
    if ((zoneCount.rows[0]?.count || 0) === 0) {
      console.log("[Startup] zone_master is empty, running zone/division seeder...");
      await runZoneDivisionSeeder(pool);
    }
  } catch (error) {
    console.error("[Startup] auto-seed masters failed:", error?.message);
  }
}

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
});

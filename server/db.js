import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

export const ENTITY_NAMES = [
  "FreightMovement",
  "MaturedIndent",
  "UploadLog",
  "RailNotification",
  "UserSettings",
  "RailwayDictionary",
  "UserNotificationPreference",
  "UserWatchlist",
  "SavedFilter",
];

const emptyDb = () =>
  Object.fromEntries(ENTITY_NAMES.map((entityName) => [entityName, []]));

export async function readDb() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { ...emptyDb(), ...parsed };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const db = emptyDb();
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

export function assertEntity(entityName) {
  if (!ENTITY_NAMES.includes(entityName)) {
    const error = new Error(`Unknown entity: ${entityName}`);
    error.status = 404;
    throw error;
  }
}

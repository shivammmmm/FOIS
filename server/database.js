import "reflect-metadata";
import { DataSource } from "typeorm";
import { FreightMovement } from "./entities/FreightMovement.js";
import { MaturedIndent } from "./entities/MaturedIndent.js";
import { UploadLog } from "./entities/UploadLog.js";
import { RailNotification } from "./entities/RailNotification.js";
import { UserSettings } from "./entities/UserSettings.js";
import { RailwayDictionary } from "./entities/RailwayDictionary.js";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: databaseUrl,
  synchronize: false, // Use migrations instead
  logging: process.env.NODE_ENV === "development",
  entities: [
    FreightMovement,
    MaturedIndent,
    UploadLog,
    RailNotification,
    UserSettings,
    RailwayDictionary,
  ],
  migrations: ["server/migrations/**/*.js"],
  subscribers: [],
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

export async function initializeDatabase() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✅ Database connected successfully");
    }
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    throw error;
  }
}

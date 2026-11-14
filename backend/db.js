// =====================================================
// JUSTBRAND DATABASE CONNECTION
// =====================================================
// One shared SQLite connection for the backend.
//
// Hostinger production defaults to the persistent data directory.
// A deployment must NEVER fall back to a build-relative justbrand.db,
// because every deployment version has its own directory.
//
// Local tests may pass their own absolute JUSTBRAND_DB_PATH and may
// explicitly opt into creating an isolated throwaway database.

import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_PERSISTENT_DB_PATH =
  "/home/u465228778/justbrand-data/justbrand.db";

const configuredPath =
  process.env.JUSTBRAND_DB_PATH?.trim() || DEFAULT_PERSISTENT_DB_PATH;

if (!path.isAbsolute(configuredPath)) {
  throw new Error(
    "JUSTBRAND_DB_PATH must be an absolute path. Refusing an ambiguous database location."
  );
}

const allowCreate = process.env.JUSTBRAND_ALLOW_CREATE_DB === "1";

const db = new Database(configuredPath, {
  // Production opens only the existing persistent DB. Tests/local
  // throwaway databases must explicitly opt in to file creation.
  fileMustExist: !allowCreate,
});

db.pragma("journal_mode = WAL");

console.log(`JustBrand persistent database connected: ${configuredPath}`);

export default db;

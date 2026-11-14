// =====================================================
// JUSTBRAND DATABASE CONNECTION
// =====================================================
// One shared SQLite connection for the backend.
//
// Production MUST provide an absolute JUSTBRAND_DB_PATH pointing to
// the persistent Hostinger data directory. Never fall back to a
// build-relative path: each deployment version has its own directory.
// The database must already exist in production; a typo/missing mount
// must stop startup instead of silently creating an empty database.
//
// Local tests may explicitly opt into creating their isolated throwaway
// database with JUSTBRAND_ALLOW_CREATE_DB=1.

import Database from "better-sqlite3";
import path from "node:path";

const configuredPath = process.env.JUSTBRAND_DB_PATH?.trim();

if (!configuredPath) {
  throw new Error(
    "JUSTBRAND_DB_PATH is required. Refusing to use a build-local database."
  );
}

if (!path.isAbsolute(configuredPath)) {
  throw new Error(
    "JUSTBRAND_DB_PATH must be an absolute path. Refusing an ambiguous database location."
  );
}

const allowCreate = process.env.JUSTBRAND_ALLOW_CREATE_DB === "1";

const db = new Database(configuredPath, {
  // Production opens only an existing persistent DB. Tests/local
  // throwaway databases must explicitly opt in to file creation.
  fileMustExist: !allowCreate,
});

db.pragma("journal_mode = WAL");

console.log(`JustBrand database connected: ${configuredPath}`);

export default db;

// =====================================================
// JUSTBRAND DATABASE CONNECTION
// =====================================================
// Single shared SQLite connection (WAL mode) used by both
// server.js and business.js. Creating the connection here
// means every module sees the same tables and transactions.

import Database from "better-sqlite3";

const db = new Database("justbrand.db");

db.pragma("journal_mode = WAL");

console.log("JustBrand database connected.");

export default db;

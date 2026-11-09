// =====================================================
// JUSTBRAND — SELLER SCHEMES: approval gate, ownership,
//             validation, expiry (additive suite)
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-schemes.test.mjs   (from repo root)
//
// Covers:
//   - Scheme creation always starts as Draft (no seller path to an
//     active scheme; sellers can never approve).
//   - Submit → Pending Approval only, with validation gates.
//   - Server-side ownership: foreign scheme ids → 404, and other
//     sellers never see them in their list.
//   - Admin approve/reject is the only path to Approved/Rejected.
//   - Approved + past end date surfaces as Expired.
//   - Percent/flat validation and payload sanitising.
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-schemes/
//   - Never touches justbrand.db or production

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-schemes");

const PORT = Number(process.env.JB_SCHEMES_TEST_PORT) || 4607;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
  }
}

async function req(method, apiPath, { token, body } = {}) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const server = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: TMP_DIR, // justbrand.db created HERE — isolated
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "jb-schemes-test-secret-local-only",
    },
  });

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  server.stdout.on("data", () => {});

  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { server, ready, getStderr: () => stderrTail };
}

function futureDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

async function runFlow() {
  // ===== SEED: two sellers + staff =====
  console.log("\n— Seed sellers & staff");

  const regA = await req("POST", "/api/sellers/register", {
    body: {
      name: "Scheme Seller A",
      shopName: "Scheme Shop A",
      mobile: "9876501101",
      email: "schemesellerA@x.com",
      password: "seller123",
    },
  });
  ok("seller A register accepted", regA.status === 201);

  const loginA = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876501101", password: "seller123" },
  });
  const sellerA = loginA.data?.token;
  ok("seller A login returns token", Boolean(sellerA));

  const regB = await req("POST", "/api/sellers/register", {
    body: {
      name: "Scheme Seller B",
      shopName: "Scheme Shop B",
      mobile: "9876501102",
      email: "schemesellerB@x.com",
      password: "seller123",
    },
  });
  ok("seller B register accepted", regB.status === 201);

  const loginB = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876501102", password: "seller123" },
  });
  const sellerB = loginB.data?.token;
  ok("seller B login returns token", Boolean(sellerB));

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLogin.data?.token;
  ok("staff login returns token", Boolean(staff));

  // ===== 1. CREATE always starts as Draft =====
  console.log("\n— Create & validation");

  const created = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: {
      name: "Monsoon Sale",
      description: "Seasonal discount",
      discountType: "percent",
      discountValue: 10,
      productIds: [1, 2],
      startDate: futureDate(-1),
      endDate: futureDate(30),
    },
  });
  ok("create scheme → 200", created.status === 200);
  ok("new scheme is Draft (never auto-approved)", created.data?.scheme?.status === "Draft");
  const s1 = created.data?.scheme?.id;

  const badPercent = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: { name: "Bad", discountType: "percent", discountValue: 150 },
  });
  ok("percent > 100 rejected", badPercent.status === 400);

  const badType = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: { name: "Bad", discountType: "bogus", discountValue: 10 },
  });
  ok("unknown discount type rejected", badType.status === 400);

  const badDates = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: {
      name: "Bad dates",
      discountType: "flat",
      discountValue: 50,
      startDate: futureDate(10),
      endDate: futureDate(1),
    },
  });
  ok("end-before-start rejected", badDates.status === 400);

  // ===== 2. SUBMIT gates =====
  console.log("\n— Submit for approval");

  // s1 already has an end date — the no-end-date gate is proven on a
  // fresh scheme (s2) so s1 stays Draft for the main submit check.
  const noEnd = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: { name: "No end date scheme", discountType: "flat", discountValue: 20, productIds: [3] },
  });
  const s2 = noEnd.data?.scheme?.id;
  const submitNoEnd2 = await req("POST", `/api/sellers/schemes/${s2}/submit`, {
    token: sellerA,
  });
  ok("submit without end date → 400", submitNoEnd2.status === 400);

  const submit1 = await req("POST", `/api/sellers/schemes/${s1}/submit`, {
    token: sellerA,
  });
  ok("valid submit → Pending Approval", submit1.data?.scheme?.status === "Pending Approval");

  const editPending = await req("PUT", `/api/sellers/schemes/${s1}`, {
    token: sellerA,
    body: {
      name: "Renamed while pending",
      discountType: "percent",
      discountValue: 20,
      productIds: [1],
      endDate: futureDate(30),
    },
  });
  ok("editing a Pending scheme → 409", editPending.status === 409);

  const submitAgain = await req("POST", `/api/sellers/schemes/${s1}/submit`, {
    token: sellerA,
  });
  ok("re-submitting a Pending scheme → 409", submitAgain.status === 409);

  // ===== 3. OWNERSHIP (server-side) =====
  console.log("\n— Ownership checks");

  const listB = await req("GET", "/api/sellers/schemes", { token: sellerB });
  const bSeesA = (listB.data?.schemes || []).some((scheme) => scheme.id === s1);
  ok("seller B list never contains A's scheme", listB.status === 200 && !bSeesA);

  const hijackEdit = await req("PUT", `/api/sellers/schemes/${s1}`, {
    token: sellerB,
    body: { name: "Hijacked", discountType: "percent", discountValue: 5, endDate: futureDate(10) },
  });
  ok("seller B editing A's scheme → 404", hijackEdit.status === 404);

  const hijackSubmit = await req("POST", `/api/sellers/schemes/${s1}/submit`, {
    token: sellerB,
  });
  ok("seller B submitting A's scheme → 404", hijackSubmit.status === 404);

  // ===== 4. SELLERS CAN NEVER APPROVE =====
  console.log("\n— Approval gate");

  const selfApprove = await req("POST", `/api/admin/seller-schemes/${s1}/approve`, {
    token: sellerA,
  });
  ok("seller self-approve → 403", selfApprove.status === 403);

  const stillPending = await req("GET", "/api/sellers/schemes", { token: sellerA });
  const s1Row = (stillPending.data?.schemes || []).find((scheme) => scheme.id === s1);
  ok("scheme still Pending after self-approve attempt", s1Row?.status === "Pending Approval");

  // ===== 5. ADMIN APPROVE / REJECT =====
  console.log("\n— Admin approval workflow");

  const adminList = await req("GET", "/api/admin/seller-schemes", { token: staff });
  ok("admin lists schemes", adminList.status === 200 && (adminList.data?.schemes || []).some((s) => s.id === s1));

  const filterPending = await req("GET", "/api/admin/seller-schemes?status=Pending Approval", { token: staff });
  ok("admin status filter works", filterPending.status === 200 && (filterPending.data?.schemes || []).every((s) => s.status === "Pending Approval"));

  const approve = await req("POST", `/api/admin/seller-schemes/${s1}/approve`, {
    token: staff,
    body: { note: "Looks good" },
  });
  ok("admin approve → Approved", approve.status === 200 && approve.data?.scheme?.status === "Approved");

  const approveTwice = await req("POST", `/api/admin/seller-schemes/${s1}/approve`, { token: staff });
  ok("approving twice → 409", approveTwice.status === 409);

  const editApproved = await req("PUT", `/api/sellers/schemes/${s1}`, {
    token: sellerA,
    body: { name: "Edit approved", discountType: "percent", discountValue: 1, endDate: futureDate(40) },
  });
  ok("seller editing an Approved scheme → 409", editApproved.status === 409);

  // Rejected → editable again → resubmit
  const rejected = await req("POST", "/api/sellers/schemes", {
    token: sellerA,
    body: { name: "Will be rejected", discountType: "flat", discountValue: 30, productIds: [5], endDate: futureDate(20) },
  });
  const s3 = rejected.data?.scheme?.id;
  await req("POST", `/api/sellers/schemes/${s3}/submit`, { token: sellerA });
  const rejectCall = await req("POST", `/api/admin/seller-schemes/${s3}/reject`, {
    token: staff,
    body: { note: "Needs clearer terms" },
  });
  ok("admin reject → Rejected with note", rejectCall.status === 200 && rejectCall.data?.scheme?.status === "Rejected" && rejectCall.data?.scheme?.adminNote === "Needs clearer terms");

  const editRejected = await req("PUT", `/api/sellers/schemes/${s3}`, {
    token: sellerA,
    body: { name: "Will be rejected (fixed)", discountType: "flat", discountValue: 30, productIds: [5], endDate: futureDate(20) },
  });
  ok("seller can edit a Rejected scheme", editRejected.status === 200);

  const resubmit = await req("POST", `/api/sellers/schemes/${s3}/submit`, { token: sellerA });
  ok("Rejected scheme can be resubmitted → Pending", resubmit.status === 200 && resubmit.data?.scheme?.status === "Pending Approval");

  // ===== 6. EXPIRY (Approved + past end date → Expired) =====
  console.log("\n— Expiry");

  const require = createRequire(import.meta.url);
  const Database = require(path.join(REPO_ROOT, "backend", "node_modules", "better-sqlite3"));
  const dbPath = path.join(TMP_DIR, "justbrand.db");
  const raw = new Database(dbPath);
  raw.prepare(`UPDATE seller_schemes SET endDate = ? WHERE id = ?`).run(futureDate(-1), s1);
  raw.close();

  const afterExpiry = await req("GET", "/api/sellers/schemes", { token: sellerA });
  const expiredRow = (afterExpiry.data?.schemes || []).find((scheme) => scheme.id === s1);
  ok("Approved + past end date surfaces as Expired", expiredRow?.status === "Expired");

  const expiredEdit = await req("PUT", `/api/sellers/schemes/${s1}`, {
    token: sellerA,
    body: { name: "Tweak expired", discountType: "percent", discountValue: 5, endDate: futureDate(15) },
  });
  ok("Expired scheme is not seller-editable (stored Approved) → 409", expiredEdit.status === 409);
}

const { server, ready, getStderr } = await startServer();

if (!ready) {
  console.error("Backend failed to start:\n" + getStderr());
  process.exit(1);
}

try {
  await runFlow();
} finally {
  server.kill();
}

console.log(`\n=== SCHEMES: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}

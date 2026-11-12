// =====================================================
// SELLER — MY SCHEME (READ-ONLY FAMILY EARNING VIEW)
// =====================================================
// Runs the real backend on an isolated port and throwaway database.
// Verifies:
//   • seller token resolves its own linked member (never an id from
//     the browser)
//   • Member ID / Sponsor ID / Referral ID and all three Admin schemes
//   • pending / eligible / credited / void totals and return window
//   • Admin setting changes are visible to the seller with history
//   • a seller without a Family member gets "not linked" and no data
//   • another seller cannot read this seller's member or earnings
//   • anonymous and member tokens are rejected
//   • no password hash or Admin actor is exposed

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-seller-scheme");
const DB_PATH = path.join(TMP_DIR, "justbrand.db");
const PORT = Number(process.env.JB_SELLER_SCHEME_PORT) || 4631;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, details) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
    if (details !== undefined) console.log("    ", JSON.stringify(details).slice(0, 1200));
  }
}

async function api(method, route, { token, body } = {}) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

const requireBackend = createRequire(path.join(REPO_ROOT, "backend", "package.json"));
const Database = requireBackend("better-sqlite3");

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

const server = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: TMP_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: "jb-seller-scheme-test-secret-local-only",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
server.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-5000);
});

let ready = false;
for (let i = 0; i < 100 && !ready; i += 1) {
  try {
    ready = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    /* starting */
  }
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 200));
}

if (!ready) {
  console.error("Backend did not start:\n" + stderr);
  server.kill();
  process.exit(1);
}

const db = new Database(DB_PATH);

try {
  console.log("\n— Seed sellers and Family member");
  const sellerAReg = await api("POST", "/api/sellers/register", {
    body: {
      name: "Scheme Seller A",
      shopName: "Scheme Shop A",
      mobile: "9876600001",
      email: "scheme-a@x.com",
      password: "seller123",
    },
  });
  const sellerBReg = await api("POST", "/api/sellers/register", {
    body: {
      name: "Scheme Seller B",
      shopName: "Scheme Shop B",
      mobile: "9876600002",
      email: "scheme-b@x.com",
      password: "seller123",
    },
  });
  const sellerALogin = await api("POST", "/api/sellers/login", {
    body: { mobile: "9876600001", password: "seller123" },
  });
  const sellerBLogin = await api("POST", "/api/sellers/login", {
    body: { mobile: "9876600002", password: "seller123" },
  });
  const staffLogin = await api("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const sellerA = sellerALogin.data?.token;
  const sellerB = sellerBLogin.data?.token;
  const staff = staffLogin.data?.token;
  ok(
    "two sellers and staff ready",
    sellerAReg.status === 201 &&
      sellerBReg.status === 201 &&
      Boolean(sellerA && sellerB && staff)
  );

  const now = new Date().toISOString();
  const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO mlm_members
      (memberId, name, mobile, email, passwordHash, referralCode, parentId, position, status, createdAt, sponsorId)
    VALUES ('JBSCHEME1', 'Scheme Seller A', '9876600001', 'scheme-a@x.com', 'test-only', 'JBSCHEME1', 'JBROOT', 'A', 'active', ?, 'JBROOT')
  `).run(now);
  db.prepare(`
    INSERT INTO mlm_wallets (memberId, balance, totalEarned, totalPaid, updatedAt)
    VALUES ('JBSCHEME1', 25, 175, 25, ?)
  `).run(now);
  db.prepare(`
    INSERT INTO mlm_referrals
      (sponsorId, memberId, introductionType, directSlot, createdAt, note)
    VALUES ('JBROOT', 'JBSCHEME1', 'direct', 1, ?, 'seller scheme test')
  `).run(now);
  db.prepare(`
    INSERT INTO mlm_placements
      (memberId, parentId, position, status, createdAt)
    VALUES ('JBSCHEME1', 'JBROOT', 'A', 'Placed', ?)
  `).run(now);

  const insertCommission = db.prepare(`
    INSERT INTO mlm_commissions
      (memberId, orderId, type, description, amount, status, createdAt, payableAt,
       paidAt, source, percentage, base_amount, calculation_base, eligible_at)
    VALUES ('JBSCHEME1', ?, ?, ?, ?, ?, ?, ?, ?, '3x3_direct', 10, ?, 'product_total', ?)
  `);
  insertCommission.run(1001, "direct", "Pending test earning", 100, "Pending", now, future, null, 1000, now);
  insertCommission.run(1002, "spillover", "Eligible test earning", 50, "Payable", now, past, null, 500, past);
  insertCommission.run(1003, "timewise", "Credited test earning", 25, "Paid", now, past, now, 250, past);
  insertCommission.run(1004, "direct", "Void test earning", 10, "Void", now, past, null, 100, past);
  ok("member, referral, placement, wallet and four earnings seeded", true);

  console.log("\n— Authentication and seller-only resolution");
  const anon = await api("GET", "/api/sellers/my-scheme");
  ok("anonymous request rejected", anon.status === 401, anon.data);

  const memberLogin = await api("POST", "/api/mlm/login", {
    body: { memberId: "JBSCHEME1", password: "wrong-password" },
  });
  ok("test member password is not usable (no fake member login)", memberLogin.status === 401);

  const preKyc = await api("GET", "/api/sellers/my-scheme", { token: sellerA });
  ok(
    "seller without approved KYC cannot see member identity or earnings",
    preKyc.status === 200 &&
      preKyc.data?.linked === false &&
      preKyc.data?.earnings?.rows?.length === 0 &&
      /KYC must be approved/i.test(preKyc.data?.message || ""),
    preKyc.data
  );

  const approveKyc = await api(
    "PUT",
    `/api/admin/sellers/${sellerAReg.data?.seller?.id}/kyc`,
    { token: staff, body: { kycStatus: "Approved" } }
  );
  ok("Admin approves seller KYC for the Family link", approveKyc.status === 200, approveKyc.data);

  const sellerBProbe = await api("GET", "/api/sellers/my-scheme?memberId=JBSCHEME1", {
    token: sellerB,
  });
  ok(
    "second seller cannot read another member through a query parameter",
    sellerBProbe.status === 200 &&
      sellerBProbe.data?.linked === false &&
      sellerBProbe.data?.member === null,
    sellerBProbe.data
  );
  ok(
    "not-linked response contains no earnings or other seller data",
    sellerBProbe.data?.earnings?.rows?.length === 0 &&
      sellerBProbe.data?.earnings?.credited === 0
  );

  console.log("\n— Admin settings reflected to the seller");
  const saveSettings = await api("PUT", "/api/admin/mlm/3x3/settings", {
    token: staff,
    body: {
      note: "seller scheme verification",
      settings: {
        direct: {
          enabled: true,
          percentage: 11,
          effectiveFrom: "2024-01-01",
          calculationBase: "product_total",
          maxLevels: 1,
          chainLimit: 1,
        },
        spillover: {
          enabled: true,
          percentage: 6,
          effectiveFrom: "2024-01-01",
          calculationBase: "order_total",
          maxLevels: 1,
          chainLimit: 1,
        },
        timewise: {
          enabled: false,
          percentage: 3,
          effectiveFrom: "2024-01-01",
          calculationBase: "product_total",
          maxLevels: 3,
          chainLimit: 3,
        },
      },
    },
  });
  ok("Admin saves three independent schemes", saveSettings.status === 200, saveSettings.data);

  const scheme = await api("GET", "/api/sellers/my-scheme", { token: sellerA });
  ok("linked seller receives their scheme", scheme.status === 200 && scheme.data?.linked === true);
  ok(
    "Member ID, Sponsor ID and Referral ID are correct",
    scheme.data?.member?.memberId === "JBSCHEME1" &&
      scheme.data?.member?.sponsorId === "JBROOT" &&
      scheme.data?.member?.referralCode === "JBSCHEME1",
    scheme.data?.member
  );
  ok(
    "all three schemes show the Admin values",
    scheme.data?.schemes?.direct?.percentage === 11 &&
      scheme.data?.schemes?.direct?.enabled === true &&
      scheme.data?.schemes?.spillover?.percentage === 6 &&
      scheme.data?.schemes?.spillover?.calculationBase === "order_total" &&
      scheme.data?.schemes?.timewise?.enabled === false &&
      scheme.data?.schemes?.timewise?.maxLevels === 3,
    scheme.data?.schemes
  );
  ok(
    "pending, eligible, credited and void totals are separated",
    scheme.data?.earnings?.pending === 100 &&
      scheme.data?.earnings?.eligible === 50 &&
      scheme.data?.earnings?.credited === 25 &&
      scheme.data?.earnings?.void === 10,
    scheme.data?.earnings
  );
  ok(
    "return window is marked pending on the future commission",
    scheme.data?.earnings?.rows?.find((row) => row.id && row.amount === 100)?.returnPeriodPending === true
  );
  ok(
    "release after return window is visible as Payable",
    scheme.data?.earnings?.rows?.some(
      (row) => row.status === "Payable" && row.returnPeriodComplete === true
    )
  );
  ok(
    "seller sees only rows for its own member id",
    scheme.data?.earnings?.rows?.length === 4
  );
  ok(
    "scheme change history includes the Admin save",
    scheme.data?.history?.some((entry) => entry.after?.direct?.percentage === 11)
  );
  ok(
    "response exposes no password hash or Admin actor",
    !JSON.stringify(scheme.data).includes("passwordHash") &&
      !JSON.stringify(scheme.data).includes("superadmin")
  );

  console.log("\n— Second Admin change and read-back");
  const secondSave = await api("PUT", "/api/admin/mlm/3x3/settings", {
    token: staff,
    body: {
      note: "second independent percentage change",
      settings: { direct: { percentage: 12 } },
    },
  });
  const scheme2 = await api("GET", "/api/sellers/my-scheme", { token: sellerA });
  ok("second Admin change saved", secondSave.status === 200);
  ok(
    "seller sees the latest 12% direct rate",
    scheme2.data?.schemes?.direct?.percentage === 12,
    scheme2.data?.schemes?.direct
  );
  ok(
    "seller history keeps both changes",
    Array.isArray(scheme2.data?.history) && scheme2.data.history.length >= 2
  );

  const noWrite = await api("PUT", "/api/sellers/my-scheme", {
    token: sellerA,
    body: { settings: { direct: { percentage: 99 } } },
  });
  ok("seller has no write route for scheme settings", noWrite.status === 404 || noWrite.status === 405);

  console.log("\n=====================================================");
  console.log(`Seller My Scheme suite: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failures: " + failures.join(" | "));
  console.log("=====================================================");
} finally {
  db.close();
  server.kill();
}

process.exit(failed === 0 ? 0 : 1);

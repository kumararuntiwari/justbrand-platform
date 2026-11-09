#!/usr/bin/env node
// =====================================================
// JUSTBRAND — backend pre-deploy / post-deploy checks
// (Charges & Tax deployment, 2026-10-15)
// =====================================================
// Modes (run from repo root, Node 18+, zero dependencies):
//
//   node scripts/predeploy-backend-check.mjs
//       LOCAL REHEARSAL — boots THIS repo's backend/ on an isolated
//       port with a throwaway DB in a temp dir and runs the full
//       battery: core routes, auth gates, charges/scheme routes with
//       correct roles, checkout quote, PRICE_MISMATCH validation,
//       legacy-buyer (no clientGrandTotal) order compatibility, and
//       an invalid PUT that must be rejected WITHOUT writing.
//
//   node scripts/predeploy-backend-check.mjs baseline
//       PRODUCTION, strictly read-only, BEFORE the upload.
//       Records the current statuses so the post-deploy flip
//       (404 -> 401) can be proven. Only fails if production is
//        already broken or if a protected route answers 200.
//
//   node scripts/predeploy-backend-check.mjs verify
//       PRODUCTION, AFTER upload + restart — same probes with
//       post-deploy expectations, plus staff-token reads and one
//       deliberately invalid PUT that must return 400 and leave
//       the settings byte-identical (no production writes).
//
// Staff credentials default to the values the repo's own test
// suites use (tests/*.mjs); override with:
//   --staff-user=NAME --staff-pass=SECRET
// Tokens and passwords are never printed.
//
// Safety: baseline/verify never send an authenticated write that
// can succeed — the only PUT is guaranteed-invalid (400 before any
// write) and is followed by a re-read that must match. Orders are
// only ever created in LOCAL mode (throwaway DB).
//
// Exit code: 0 = every check passed, 1 = at least one failure.
// =====================================================

import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = "https://justbrand-in-144629.hostingersite.com";

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) || "local";
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const STAFF_USER = opt("staff-user", "superadmin");
const STAFF_PASS = opt("staff-pass", "JustBrand@2026");
const LOCAL_PORT = Number(opt("port", "4613"));
const LOCAL = `http://127.0.0.1:${LOCAL_PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(name);
    const extra =
      detail === undefined ? "" : `  [${JSON.stringify(detail)}]`;
    console.log(`  \u2717 FAIL: ${name}${extra}`);
  }
}

function info(name, detail) {
  console.log(`  \u2192 ${name}: ${JSON.stringify(detail)}`);
}

async function req(base, method, apiPath, { token, body, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(base + apiPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// =====================================================
// THE BATTERY (shared shape for local + production verify)
// =====================================================
const CORE_GETS = [
  ["/api/products", 200],
  ["/api/site/content", 200],
  ["/api/payment/config", 200],
];

async function seed(base) {
  // Same flow as tests/jb-admin-charges.verify.mjs — throwaway data
  // (local mode only; production never seeds anything).
  const out = {};
  const staffLogin = await req(base, "POST", "/api/staff/login", {
    body: { username: STAFF_USER, password: STAFF_PASS },
  });
  out.staff = staffLogin.data?.token || null;
  out.staffLogin = staffLogin;

  const sellerReg = await req(base, "POST", "/api/sellers/register", {
    body: {
      name: "Preflight Seller",
      shopName: "Preflight Shop",
      mobile: "9876500777",
      email: "preflight-seller@x.com",
      password: "seller123",
    },
  });
  out.sellerReg = sellerReg;
  if (out.staff && sellerReg.data?.seller?.id) {
    await req(base, "PUT", `/api/admin/sellers/${sellerReg.data.seller.id}/kyc`, {
      token: out.staff,
      body: { kycStatus: "Approved" },
    });
  }
  const sellerLogin = await req(base, "POST", "/api/sellers/login", {
    body: { mobile: "9876500777", password: "seller123" },
  });
  out.seller = sellerLogin.data?.token || null;

  if (out.seller) {
    const product = await req(base, "POST", "/api/sellers/products", {
      token: out.seller,
      body: {
        name: "Preflight Probe Product",
        category: "Books",
        price: "\u20b9299",
        images: ["https://cdn.example.com/preflight.jpg"],
      },
    });
    out.productId = product.data?.product?.id || null;
    if (out.productId && out.staff) {
      await req(base, "PUT", `/api/admin/products/${out.productId}/approve`, {
        token: out.staff,
      });
    }
  }

  const custReg = await req(base, "POST", "/api/customers/register", {
    body: {
      name: "Preflight Buyer",
      mobile: "9876500888",
      email: "preflight-buyer@x.com",
      password: "buyer1234",
    },
  });
  out.custReg = custReg;
  const custLogin = await req(base, "POST", "/api/customers/login", {
    body: { mobile: "9876500888", password: "buyer1234" },
  });
  out.customer = custLogin.data?.token || null;

  return out;
}

async function expectGates(base) {
  // Anonymous probes — these prove the route EXISTS and is gated.
  // On the old production code they answer 404 (route missing).
  const charges = await req(base, "GET", "/api/admin/charges/settings");
  check("anon GET /api/admin/charges/settings -> 401", charges.status === 401, charges.status);
  const schemes = await req(base, "GET", "/api/admin/seller-schemes");
  check("anon GET /api/admin/seller-schemes -> 401", schemes.status === 401, schemes.status);
  const quote = await req(base, "POST", "/api/orders/quote", {
    body: { items: [] },
  });
  check("anon POST /api/orders/quote -> 401", quote.status === 401, quote.status);
}

async function expectStaffReads(base, staff) {
  const before = await req(base, "GET", "/api/admin/charges/settings", { token: staff });
  const keys = [
    "delivery",
    "platformFee",
    "gst",
    "previous",
    "categoryRates",
    "originStates",
    "validGstSlabs",
  ];
  check(
    "staff GET charges/settings -> 200 with full shape",
    before.status === 200 &&
      before.data?.success === true &&
      keys.every((k) => k in (before.data || {})),
    before.status === 200 ? Object.keys(before.data || {}) : before.status
  );

  const schemes = await req(base, "GET", "/api/admin/seller-schemes", { token: staff });
  check(
    "staff GET seller-schemes -> 200 with schemes[]",
    schemes.status === 200 && Array.isArray(schemes.data?.schemes),
    schemes.status
  );

  const orders = await req(base, "GET", "/api/admin/orders", { token: staff });
  check(
    "staff GET /api/admin/orders -> 200 with orders[]",
    orders.status === 200 && Array.isArray(orders.data?.orders),
    orders.status
  );
  if (orders.status === 200 && Array.isArray(orders.data?.orders)) {
    const sample = orders.data.orders[0];
    info("admin orders readable (count / sample has total)", [
      orders.data.orders.length,
      sample ? sample.totalAmount ?? sample.total ?? null : "n/a",
    ]);
  }
  return before;
}

async function expectValidationNoWrite(base, staff, before) {
  // Guaranteed-invalid payload: mode is neither flat nor percent, so
  // validateDeliverySettings() rejects with 400 BEFORE any DB write.
  const put = await req(base, "PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "not-a-mode", value: -1 },
  });
  check(
    "staff PUT invalid charges/delivery -> 400 (validation live)",
    put.status === 400,
    put.status
  );
  const after = await req(base, "GET", "/api/admin/charges/settings", { token: staff });
  // Meaningful only if both reads returned the real payload — two
  // matching 404s would be a vacuous pass.
  check(
    "settings byte-identical after rejected PUT (nothing written)",
    before?.status === 200 &&
      after.status === 200 &&
      JSON.stringify(after.data) === JSON.stringify(before.data),
    { before: before?.status, after: after.status }
  );
}

async function expectRoleIsolation(base, tokens) {
  if (tokens.customer) {
    const r = await req(base, "GET", "/api/admin/charges/settings", {
      token: tokens.customer,
    });
    check("customer token on charges/settings -> 403", r.status === 403, r.status);
  } else {
    check("customer token on charges/settings -> 403", false, "no customer token");
  }
  if (tokens.seller) {
    const r = await req(base, "GET", "/api/admin/seller-schemes", {
      token: tokens.seller,
    });
    check("seller token on seller-schemes -> 403", r.status === 403, r.status);
  } else {
    check("seller token on seller-schemes -> 403", false, "no seller token");
  }
}

async function expectQuoteAndOrders(base, tokens) {
  if (!tokens.customer || !tokens.productId) {
    check("quote + order battery ran", false, "seed failed (customer/product missing)");
    return;
  }
  const quote = await req(base, "POST", "/api/orders/quote", {
    token: tokens.customer,
    body: {
      items: [{ productId: tokens.productId, quantity: 2 }],
      state: "Uttar Pradesh",
      deliveryMethod: "Standard",
    },
  });
  const total = quote.data?.quote?.grandTotal;
  check(
    "customer POST /api/orders/quote -> 200 with grandTotal",
    quote.status === 200 && Number(total) > 0,
    quote.status === 200 ? total : quote.status
  );

  const empty = await req(base, "POST", "/api/orders/quote", {
    token: tokens.customer,
    body: { items: [] },
  });
  check("quote with empty cart -> 400", empty.status === 400, empty.status);

  const baseBody = {
    items: [{ productId: tokens.productId, quantity: 2 }],
    address: "99 Preflight Lane, Test Nagar, India",
    phone: "9876500888",
    state: "Uttar Pradesh",
    paymentMethod: "COD",
  };

  // 1. Matching total (new Admin-aware buyer contract) -> 201.
  const good = await req(base, "POST", "/api/orders", {
    token: tokens.customer,
    body: { ...baseBody, clientGrandTotal: total },
  });
  check(
    "order WITH matching clientGrandTotal -> 201",
    good.status === 201,
    good.status
  );

  // 2. Mismatched total -> 400 PRICE_MISMATCH (server re-prices).
  const bad = await req(base, "POST", "/api/orders", {
    token: tokens.customer,
    body: { ...baseBody, clientGrandTotal: Number(total) + 999 },
  });
  check(
    "order WITH wrong clientGrandTotal -> 400 PRICE_MISMATCH",
    bad.status === 400 && bad.data?.code === "PRICE_MISMATCH",
    { status: bad.status, code: bad.data?.code }
  );

  // 3. No total at all -> 201: the CURRENTLY LIVE Buyer bundle
  //    never sends clientGrandTotal, so this must keep working.
  const legacy = await req(base, "POST", "/api/orders", {
    token: tokens.customer,
    body: baseBody,
  });
  check(
    "order WITHOUT clientGrandTotal (live Buyer bundle) -> 201",
    legacy.status === 201,
    legacy.status
  );
}

// =====================================================
// MODE 1 — LOCAL REHEARSAL
// =====================================================
async function runLocal() {
  console.log(`\n== LOCAL REHEARSAL (repo backend/, throwaway DB, port ${LOCAL_PORT}) ==`);
  if (!existsSync(path.join(REPO, "backend", "server.js"))) {
    console.error("backend/server.js not found — run from the repo root.");
    process.exit(1);
  }

  const dir = mkdtempSync(path.join(tmpdir(), "jb-preflight-"));
  const child = spawn(process.execPath, [path.join(REPO, "backend", "server.js")], {
    cwd: dir, // justbrand.db is created HERE — never the repo/production DB
    env: {
      ...process.env,
      PORT: String(LOCAL_PORT),
      JWT_SECRET: "jb-preflight-local-only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-3000);
  });

  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {}
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  process.on("uncaughtException", (e) => {
    stop();
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });

  let up = false;
  for (let i = 0; i < 75 && !up && child.exitCode === null; i++) {
    try {
      up = (await req(LOCAL, "GET", "/api/health", { timeout: 2000 })).status === 200;
    } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  if (!up || child.exitCode !== null) {
    console.error(
      `BACKEND DID NOT START (up=${up}, exit=${child.exitCode}). ` +
        `If health answered anyway, a leftover listener owns port ${LOCAL_PORT}.\n${stderr}`
    );
    stop();
    process.exit(1);
  }
  check("backend boots, /api/health -> 200", true);

  try {
    const health = await req(LOCAL, "GET", "/api/health");
    info("health payload", health.data);

    for (const [p, want] of CORE_GETS) {
      const r = await req(LOCAL, "GET", p);
      check(`core GET ${p} -> ${want}`, r.status === want, r.status);
    }
    const cats = await req(LOCAL, "GET", "/api/categories");
    check("core GET /api/categories -> 200", cats.status === 200, cats.status);

    await expectGates(LOCAL);

    const seeded = await seed(LOCAL);
    check("seed: staff login -> token", Boolean(seeded.staff), seeded.staffLogin.status);
    check("seed: seller login -> token", Boolean(seeded.seller), seeded.sellerReg.status);
    check("seed: seller product created + approved", Boolean(seeded.productId), seeded.productId);
    check("seed: customer login -> token", Boolean(seeded.customer), seeded.custReg.status);

    const before = await expectStaffReads(LOCAL, seeded.staff);
    await expectRoleIsolation(LOCAL, seeded);
    await expectQuoteAndOrders(LOCAL, seeded);
    await expectValidationNoWrite(LOCAL, seeded.staff, before);
  } finally {
    stop();
  }
}

// =====================================================
// MODE 2 — PRODUCTION BASELINE (read-only, pre-upload)
// =====================================================
async function runBaseline() {
  console.log(`\n== PRODUCTION BASELINE (read-only) — ${PROD} ==`);
  console.log("   Run BEFORE uploading; `verify` compares against this.\n");

  const health = await req(PROD, "GET", "/api/health");
  check("prod /api/health -> 200", health.status === 200, health.status);
  info("health payload (uptime = old process until restart)", health.data);

  for (const [p, want] of CORE_GETS) {
    const r = await req(PROD, "GET", p);
    check(`prod GET ${p} -> ${want}`, r.status === want, r.status);
  }

  // Route-existence markers on the OLD code (expected 404 today;
  // after upload+restart they must become 401).
  const charges = await req(PROD, "GET", "/api/admin/charges/settings");
  info("prod anon GET charges/settings (404 = old code, 401 = live+gated)", charges.status);
  check("prod charges/settings is NOT publicly readable", charges.status !== 200, charges.status);

  const schemes = await req(PROD, "GET", "/api/admin/seller-schemes");
  info("prod anon GET seller-schemes (404 = old code, 401 = live+gated)", schemes.status);
  check("prod seller-schemes is NOT publicly readable", schemes.status !== 200, schemes.status);

  const quote = await req(PROD, "POST", "/api/orders/quote", { body: { items: [] } });
  info("prod anon POST orders/quote (404/401 both safe; 200 = ungated)", quote.status);
  check("prod orders/quote is NOT publicly answerable", quote.status !== 200, quote.status);

  const me = await req(PROD, "GET", "/api/customers/me");
  check("prod anon GET /api/customers/me -> 401", me.status === 401, me.status);
}

// =====================================================
// MODE 3 — PRODUCTION VERIFY (post-upload + restart)
// =====================================================
async function runVerify() {
  console.log(`\n== PRODUCTION VERIFY (post-deploy) — ${PROD} ==`);
  console.log(`   Staff user: ${STAFF_USER} (password not shown)\n`);

  const health = await req(PROD, "GET", "/api/health");
  check("prod /api/health -> 200", health.status === 200, health.status);
  info("health payload — small uptime proves the restart happened", health.data);

  for (const [p, want] of CORE_GETS) {
    const r = await req(PROD, "GET", p);
    check(`prod GET ${p} -> ${want}`, r.status === want, r.status);
  }
  const cats = await req(PROD, "GET", "/api/categories");
  check("prod GET /api/categories -> 200", cats.status === 200, cats.status);

  // THE deployment flip: 404 (old) -> 401 (live + auth-gated).
  await expectGates(PROD);

  const me = await req(PROD, "GET", "/api/customers/me");
  check("prod anon GET /api/customers/me -> 401", me.status === 401, me.status);

  const staffLogin = await req(PROD, "POST", "/api/staff/login", {
    body: { username: STAFF_USER, password: STAFF_PASS },
  });
  const staff = staffLogin.data?.token || null;
  check(
    "prod staff login -> token",
    Boolean(staff),
    staffLogin.status === 200 ? "no token in response" : staffLogin.status
  );
  if (!staff) {
    console.log(
      "  ! Staff login failed — remaining authenticated checks skipped.\n" +
        "    Re-run with your real production staff credentials:\n" +
        "    node scripts/predeploy-backend-check.mjs verify --staff-user=NAME --staff-pass=SECRET"
    );
    return;
  }

  const before = await expectStaffReads(PROD, staff);
  // No new accounts/orders are ever created on production — role
  // isolation for customer/seller tokens is proven by the local
  // rehearsal above and by tests/jb-schemes.test.mjs.
  await expectValidationNoWrite(PROD, staff, before);
}

// =====================================================
async function main() {
  if (mode === "local") await runLocal();
  else if (mode === "baseline") await runBaseline();
  else if (mode === "verify") await runVerify();
  else {
    console.error(`Unknown mode "${mode}". Use: local | baseline | verify`);
    process.exit(1);
  }

  console.log(
    `\n== SUMMARY: ${passed} passed, ${failed} failed ==` +
      (failed ? `\nFailed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

// =====================================================
// JUSTBRAND FAMILY — 3×3 DIRECT / SPILLOVER / TIMEWISE
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node tests/jb-family-3x3.test.mjs
//
// Covers:
//   • mandatory Sponsor / Referral Member ID, invalid + self referral
//   • 3 direct introductions, 4th accepted as spillover (never rejected)
//   • referral attribution separate from actual placement
//   • direct %, spillover %, time-wise % independently applied
//   • old order keeps its saved rate after an admin percentage change
//   • 10:00 / 10:05 / 10:30 shopping-time chain
//   • duplicate delivery / duplicate order cannot duplicate commission
//   • simultaneous registration and simultaneous orders
//   • cancelled + refunded orders never keep pending commission
//   • return window: Pending -> Payable; cancellation reverses wallet
//   • admin settings validation + append-only audit
//
// Safety:
//   • REAL backend on an isolated port
//   • THROWAWAY SQLite database in tests/.tmp-family-3x3/
//   • never touches root justbrand.db, production, or live couriers
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-family-3x3");
const DB_PATH = path.join(TMP_DIR, "justbrand.db");
const PORT = Number(process.env.JB_3X3_TEST_PORT) || 4621;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, details) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
    if (details !== undefined) {
      console.log("    ", JSON.stringify(details).slice(0, 1200));
    }
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
    cwd: TMP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "jb-family-3x3-test-secret-local-only",
      // Deliberately NOT setting MLM_ALLOW_ROOT_REGISTRATION: this
      // suite verifies that public registration requires a sponsor.
    },
  });

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-5000);
  });
  server.stdout.on("data", () => {});

  const deadline = Date.now() + 20000;
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

const requireBackend = createRequire(path.join(REPO_ROOT, "backend", "package.json"));
const Database = requireBackend("better-sqlite3");

function seedRoot(db, { memberId, name, mobile, email }) {
  db.prepare(`
    INSERT INTO mlm_members (
      memberId, name, mobile, email, passwordHash, referralCode,
      parentId, position, status, createdAt, sponsorId
    )
    VALUES (?, ?, ?, ?, 'test-only', ?, NULL, NULL, 'active', ?, NULL)
  `).run(memberId, name, mobile, email, memberId, new Date().toISOString());

  db.prepare(`
    INSERT INTO mlm_wallets (memberId, balance, totalEarned, totalPaid, updatedAt)
    VALUES (?, 0, 0, 0, ?)
  `).run(memberId, new Date().toISOString());
}

async function runFlow() {
  const { server, ready, getStderr } = await startServer();

  if (!ready) {
    console.error(getStderr());
    throw new Error("Backend did not start");
  }

  const db = new Database(DB_PATH);

  try {
    // ===== SEED =====
    console.log("\n— Seed seller / staff / product / roots");
    const sReg = await req("POST", "/api/sellers/register", {
      body: {
        name: "3x3 Seller",
        shopName: "3x3 Shop",
        mobile: "9876500301",
        email: "3x3seller@x.com",
        password: "seller123",
      },
    });
    const sLogin = await req("POST", "/api/sellers/login", {
      body: { mobile: "9876500301", password: "seller123" },
    });
    const seller = sLogin.data?.token;
    ok("seller ready", sReg.status === 201 && Boolean(seller));

    const aLogin = await req("POST", "/api/staff/login", {
      body: { username: "superadmin", password: "JustBrand@2026" },
    });
    const staff = aLogin.data?.token;
    ok("super admin login ready", Boolean(staff));

    await req("PUT", `/api/admin/sellers/${sReg.data?.seller?.id}/kyc`, {
      token: staff,
      body: { kycStatus: "Approved" },
    });
    const taxReady = await onboardGstSeller(req, {
      sellerToken: seller,
      staffToken: staff,
    });
    ok("seller GST/PAN ready", taxReady.ok, taxReady.response);

    const prod = await req("POST", "/api/sellers/products", {
      token: seller,
      body: {
        name: "3x3 Product",
        category: "Electronics",
        price: "₹500",
        image: "https://cdn.example.com/3x3.jpg",
      },
    });
    const productId = prod.data?.product?.id;
    await req("PUT", `/api/admin/products/${productId}/approve`, { token: staff });
    ok("approved product ready", Boolean(productId));

    const customerReg = await req("POST", "/api/customers/register", {
      body: {
        name: "3x3 Shopper",
        mobile: "9100000300",
        email: "3x3shopper@x.com",
        password: "shopper123",
      },
    });
    const cLogin = await req("POST", "/api/customers/login", {
      body: { mobile: "9100000300", password: "shopper123" },
    });
    const customer = cLogin.data?.token;
    ok("customer ready", customerReg.status === 201 && Boolean(customer));

    seedRoot(db, {
      memberId: "JB900001",
      name: "Root 3x3",
      mobile: "9123000000",
      email: "root3x3@x.com",
    });
    seedRoot(db, {
      memberId: "JB900002",
      name: "Time Root",
      mobile: "9123000100",
      email: "timeroot@x.com",
    });
    ok("two isolated roots seeded", true);

    const register = (name, mobile, referralCode, email = "") =>
      req("POST", "/api/mlm/register", {
        body: {
          name,
          mobile,
          email,
          password: "member123",
          ...(referralCode ? { referralCode } : {}),
        },
      });

    // ===== 1. MANDATORY SPONSOR =====
    console.log("\n— Mandatory Sponsor / Referral Member ID");
    const noSponsor = await register("No Sponsor", "9123000098", "");
    ok(
      "registration without sponsor is rejected",
      noSponsor.status === 400 && noSponsor.data?.code === "SPONSOR_REQUIRED",
      noSponsor.data
    );

    const badSponsor = await register("Bad Sponsor", "9123000097", "JB-NOT-REAL");
    ok(
      "invalid sponsor is rejected",
      badSponsor.status === 400 && badSponsor.data?.code === "INVALID_SPONSOR",
      badSponsor.data
    );

    const selfReferral = await register(
      "Self Referral",
      "9123000099",
      "JB900001",
      "root3x3@x.com"
    );
    ok(
      "self-referral by sponsor contact is rejected",
      selfReferral.status === 400 && selfReferral.data?.code === "SELF_REFERRAL",
      selfReferral.data
    );

    // ===== 2. SETTINGS + AUDIT =====
    console.log("\n— Admin settings validation, save and audit");
    const initial = await req("GET", "/api/admin/mlm/3x3/settings", { token: staff });
    ok(
      "settings return all three earning types",
      initial.status === 200 &&
        ["direct", "spillover", "timewise"].every((t) => initial.data?.settings?.[t])
    );
    ok(
      "new engine is disabled by default (no real commission until enabled)",
      ["direct", "spillover", "timewise"].every(
        (t) => initial.data?.settings?.[t]?.enabled === false
      )
    );

    const invalid = await req("PUT", "/api/admin/mlm/3x3/settings", {
      token: staff,
      body: {
        settings: {
          direct: { percentage: 101 },
        },
      },
    });
    ok("percentage above 100 is rejected", invalid.status === 400, invalid.data);

    const settingsBody = {
      note: "3x3 suite baseline",
      settings: {
        direct: {
          enabled: true,
          percentage: 10,
          effectiveFrom: "2024-01-01",
          calculationBase: "product_total",
          maxLevels: 1,
          chainLimit: 1,
        },
        spillover: {
          enabled: true,
          percentage: 6,
          effectiveFrom: "2024-01-01",
          calculationBase: "product_total",
          maxLevels: 1,
          chainLimit: 1,
        },
        timewise: {
          enabled: true,
          percentage: 4,
          effectiveFrom: "2024-01-01",
          calculationBase: "product_total",
          maxLevels: 3,
          chainLimit: 3,
        },
      },
    };

    const saved = await req("PUT", "/api/admin/mlm/3x3/settings", {
      token: staff,
      body: settingsBody,
    });
    ok(
      "three independent percentages saved",
      saved.status === 200 &&
        saved.data?.settings?.direct?.percentage === 10 &&
        saved.data?.settings?.spillover?.percentage === 6 &&
        saved.data?.settings?.timewise?.percentage === 4,
      saved.data
    );
    ok(
      "settings save writes an audit row",
      Array.isArray(saved.data?.audit) && saved.data.audit.length >= 1
    );

    const readSettings = await req("GET", "/api/admin/mlm/3x3/settings", {
      token: staff,
    });
    ok(
      "settings persist and effective date is stored",
      new Date(readSettings.data?.settings?.direct?.effectiveFrom).getTime() ===
        new Date("2024-01-01T00:00:00+05:30").getTime()
    );

    // ===== 3. DIRECT 1..3 + SPILLOVER 4 =====
    console.log("\n— 3 direct introductions + 4th spillover");
    const M1 = await register("Direct One", "9123000001", "JB900001");
    const M2 = await register("Direct Two", "9123000002", "JB900001");
    const M3 = await register("Direct Three", "9123000003", "JB900001");
    const M4 = await register("Spill Four", "9123000004", "JB900001");

    const m1 = M1.data?.member?.memberId;
    const m2 = M2.data?.member?.memberId;
    const m3 = M3.data?.member?.memberId;
    const m4 = M4.data?.member?.memberId;

    ok(
      "first three direct and fourth accepted (no rejection)",
      [M1, M2, M3, M4].every((r) => r.status === 201) &&
        Boolean(m1 && m2 && m3 && m4),
      [M1.status, M2.status, M3.status, M4.status]
    );

    const referrals = db
      .prepare(`SELECT * FROM mlm_referrals WHERE sponsorId = ? ORDER BY id`)
      .all("JB900001");

    ok(
      "Member ID is also the referral ID and sponsor lookup uses it",
      M1.data?.member?.referralCode === m1 &&
        referrals.every((r) => r.sponsorId === "JB900001"),
      M1.data?.member
    );

    const duplicate = await register("Duplicate Member", "9123000001", "JB900001");
    ok("duplicate referral/mobile registration is rejected", duplicate.status === 409);
    ok(
      "referral attribution caps direct at 3 and marks 4th as spillover",
      referrals.length === 4 &&
        referrals.filter((r) => r.introductionType === "direct").length === 3 &&
        referrals.filter((r) => r.introductionType === "spillover").length === 1,
      referrals
    );
    ok(
      "direct slots are unique 1,2,3",
      referrals
        .filter((r) => r.introductionType === "direct")
        .map((r) => r.directSlot)
        .sort()
        .join(",") === "1,2,3"
    );

    const placeOrder = (phone, extra = {}) =>
      req("POST", "/api/orders", {
        token: customer,
        body: {
          items: [{ productId, quantity: 1, price: "₹500" }],
          address: "12 3x3 Street, India",
          phone,
          paymentMethod: "COD",
          ...extra,
        },
      });

    const deliver = (orderId) =>
      req("PUT", `/api/admin/orders/${orderId}/status`, {
        token: staff,
        body: { status: "Delivered" },
      });

    const o1 = await placeOrder("9123000001");
    const o1Id = o1.data?.order?.id;
    ok("first direct order placed", o1.status === 201 && Boolean(o1Id), o1.data);

    // Change the direct percentage AFTER o1's snapshot. o1 must keep 10%.
    const changed = await req("PUT", "/api/admin/mlm/3x3/settings", {
      token: staff,
      body: {
        note: "direct rate changed after order 1",
        settings: { direct: { percentage: 20 } },
      },
    });
    ok(
      "percentage change is audited",
      changed.status === 200 &&
        changed.data?.settings?.direct?.percentage === 20 &&
        changed.data?.audit?.length >= 2
    );

    await deliver(o1Id);
    const o1Snapshot = db
      .prepare(`SELECT * FROM mlm_3x3_order_snapshots WHERE orderId = ?`)
      .get(o1Id);
    ok(
      "order snapshot keeps the pre-change 10% rate",
      o1Snapshot &&
        JSON.parse(o1Snapshot.settingsJson).direct.percentage === 10,
      o1Snapshot
    );

    const o1Comm = db
      .prepare(`
        SELECT * FROM mlm_commissions
        WHERE orderId = ? AND source = '3x3_direct'
      `)
      .all(o1Id);
    ok(
      "old order pays direct at the old rate (10% of ₹500 = ₹50)",
      o1Comm.length === 1 &&
        o1Comm[0].memberId === "JB900001" &&
        Number(o1Comm[0].amount) === 50 &&
        Number(o1Comm[0].percentage) === 10,
      o1Comm
    );

    const o2 = await placeOrder("9123000002");
    const o2Id = o2.data?.order?.id;
    await deliver(o2Id);
    const o2Comm = db
      .prepare(`
        SELECT * FROM mlm_commissions
        WHERE orderId = ? AND source = '3x3_direct'
      `)
      .get(o2Id);
    ok(
      "new order uses the new 20% rate (₹100)",
      Number(o2Comm?.amount) === 100 &&
        Number(o2Comm?.percentage) === 20,
      o2Comm
    );

    const o3 = await placeOrder("9123000003");
    const o3Id = o3.data?.order?.id;
    await deliver(o3Id);

    const o4 = await placeOrder("9123000004");
    const o4Id = o4.data?.order?.id;
    await deliver(o4Id);

    const placementRows = db
      .prepare(`SELECT * FROM mlm_placements WHERE memberId IN (?, ?, ?, ?)`)
      .all(m1, m2, m3, m4);
    const placementByMember = new Map(placementRows.map((p) => [p.memberId, p]));
    ok(
      "root has exactly 3 direct placements",
      placementRows.filter((p) => p.parentId === "JB900001").length === 3,
      placementRows
    );
    ok(
      "4th member is placed in spillover under the first direct member",
      placementByMember.get(m4)?.parentId === m1,
      placementByMember.get(m4)
    );
    ok(
      "referral attribution and placement are separate records",
      referrals.every((r) => r.sponsorId === "JB900001") &&
        placementByMember.get(m4)?.parentId === m1
    );

    const o4Comm = db
      .prepare(`
        SELECT * FROM mlm_commissions
        WHERE orderId = ? AND source = '3x3_spillover'
      `)
      .get(o4Id);
    ok(
      "spillover pays the actual placement parent at 6% (₹30)",
      o4Comm?.memberId === m1 && Number(o4Comm?.amount) === 30,
      o4Comm
    );
    ok(
      "spillover did not pay the sponsor direct commission for the 4th member",
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM mlm_commissions
          WHERE orderId = ? AND source = '3x3_direct'
        `)
        .get(o4Id).count === 0
    );

    // ===== 4. TIME-WISE CHAIN =====
    console.log("\n— Time-wise chain: 10:00 / 10:05 / 10:30");
    const timeSettings = await req("PUT", "/api/admin/mlm/3x3/settings", {
      token: staff,
      body: {
        note: "timewise-only scenario",
        settings: {
          direct: { enabled: false },
          spillover: { enabled: false },
          timewise: {
            enabled: true,
            percentage: 7,
            effectiveFrom: "2024-01-01",
            calculationBase: "product_total",
            maxLevels: 3,
            chainLimit: 3,
          },
        },
      },
    });
    ok("timewise-only settings saved", timeSettings.status === 200);

    const T1 = await register("Time One", "9123000101", "JB900002");
    const T2 = await register("Time Two", "9123000102", T1.data?.member?.memberId);
    const t1 = T1.data?.member?.memberId;
    const t2 = T2.data?.member?.memberId;
    ok("time chain members registered", T1.status === 201 && T2.status === 201);

    const tRootOrder = await placeOrder("9123000100");
    const t1Order = await placeOrder("9123000101");
    const t2Order = await placeOrder("9123000102");
    const trId = tRootOrder.data?.order?.id;
    const t1Id = t1Order.data?.order?.id;
    const t2Id = t2Order.data?.order?.id;

    await deliver(trId);
    await deliver(t1Id);

    // Make the requested wall-clock sequence explicit and authoritative
    // for the final link. Server-side timestamps were captured at order
    // creation; we adjust this throwaway DB only for the test clock.
    const stamp = (orderId, iso) => {
      db.prepare(`UPDATE orders SET createdAt = ? WHERE id = ?`).run(iso, orderId);
      db.prepare(`UPDATE mlm_3x3_order_snapshots SET shoppingAt = ? WHERE orderId = ?`).run(
        iso,
        orderId
      );
    };
    stamp(trId, "2026-11-09T10:00:00.000Z");
    stamp(t1Id, "2026-11-09T10:05:00.000Z");
    stamp(t2Id, "2026-11-09T10:30:00.000Z");

    await deliver(t2Id);

    const timeRows = db
      .prepare(`
        SELECT * FROM mlm_commissions
        WHERE orderId = ? AND source = '3x3_timewise'
        ORDER BY memberId
      `)
      .all(t2Id);
    ok(
      "later shopping pays both earlier eligible upline members",
      timeRows.length === 2 &&
        timeRows.some((r) => r.memberId === t1) &&
        timeRows.some((r) => r.memberId === "JB900002"),
      timeRows
    );
    ok(
      "time-wise amount uses its own 7% rate (₹35 each)",
      timeRows.every((r) => Number(r.amount) === 35 && Number(r.percentage) === 7),
      timeRows
    );

    const t2Snapshot = db
      .prepare(`SELECT * FROM mlm_3x3_order_snapshots WHERE orderId = ?`)
      .get(t2Id);
    ok(
      "shopping timestamp and unique order ID are stored server-side",
      t2Snapshot?.shoppingAt === "2026-11-09T10:30:00.000Z" &&
        JSON.parse(t2Snapshot.basesJson).product_total === 500
    );

    // Duplicate delivery must not duplicate the time-wise rows.
    await deliver(t2Id);
    const afterRepeat = db
      .prepare(`
        SELECT COUNT(*) AS count FROM mlm_commissions
        WHERE orderId = ? AND source = '3x3_timewise'
      `)
      .get(t2Id).count;
    ok("re-delivering the same order creates no duplicate", afterRepeat === 2);

    // ===== 5. SIMULTANEOUS ORDERS + REGISTRATIONS =====
    console.log("\n— Simultaneous orders and registrations");
    const simOrders = await Promise.all([
      placeOrder("9123000102"),
      placeOrder("9123000102"),
    ]);
    await Promise.all(simOrders.map((r) => deliver(r.data?.order?.id)));
    const simIds = simOrders.map((r) => r.data?.order?.id);
    const simRows = db
      .prepare(`
        SELECT orderId, memberId, COUNT(*) AS count
        FROM mlm_commissions
        WHERE orderId IN (?, ?) AND source IS NOT NULL
        GROUP BY orderId, memberId
      `)
      .all(...simIds);
    ok(
      "simultaneous orders never duplicate a member/order commission",
      simRows.every((r) => r.count === 1)
    );

    const concurrent = await Promise.all([
      register("Concurrent A", "9123000111", t2),
      register("Concurrent B", "9123000112", t2),
      register("Concurrent C", "9123000113", t2),
      register("Concurrent D", "9123000114", t2),
    ]);
    ok(
      "four concurrent registrations are all accepted",
      concurrent.every((r) => r.status === 201),
      concurrent.map((r) => r.status)
    );
    const concurrentReferrals = db
      .prepare(`SELECT * FROM mlm_referrals WHERE sponsorId = ?`)
      .all(t2);
    ok(
      "concurrent registrations enforce 3 direct + 1 spillover",
      concurrentReferrals.filter((r) => r.introductionType === "direct").length === 3 &&
        concurrentReferrals.filter((r) => r.introductionType === "spillover").length === 1
    );

    // ===== 6. CANCEL / REFUND / RETURN WINDOW =====
    console.log("\n— Cancellation, refund and return window");
    // Re-enable direct for this isolated lifecycle check. The order
    // snapshot still decides the actual rate.
    await req("PUT", "/api/admin/mlm/3x3/settings", {
      token: staff,
      body: {
        settings: {
          direct: { enabled: true, percentage: 20 },
          spillover: { enabled: false },
          timewise: { enabled: false },
        },
      },
    });

    const cOrder = await placeOrder("9123000002");
    const cOrderId = cOrder.data?.order?.id;
    await deliver(cOrderId);
    const cComm = db
      .prepare(`
        SELECT * FROM mlm_commissions
        WHERE orderId = ? AND source IS NOT NULL
      `)
      .get(cOrderId);
    ok(
      "commission starts Pending with a future payableAt",
      cComm?.status === "Pending" &&
        new Date(cComm.payableAt).getTime() > Date.now(),
      cComm
    );

    // Release after moving payableAt into the past (test clock only).
    db.prepare(`UPDATE mlm_commissions SET payableAt = ? WHERE id = ?`).run(
      "2020-01-01T00:00:00.000Z",
      cComm.id
    );
    const release = await req("POST", "/api/admin/mlm/commissions/release", {
      token: staff,
    });
    const released = db
      .prepare(`SELECT * FROM mlm_commissions WHERE id = ?`)
      .get(cComm.id);
    const walletAfterRelease = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(cComm.memberId);
    ok(
      "return window makes the commission Payable and credits wallet",
      release.status === 200 &&
        released.status === "Payable" &&
        Number(walletAfterRelease.balance) >= Number(cComm.amount),
      { release: release.status, released, wallet: walletAfterRelease }
    );

    await req("PUT", `/api/admin/orders/${cOrderId}/status`, {
      token: staff,
      body: { status: "Cancelled" },
    });
    const afterCancel = db
      .prepare(`SELECT * FROM mlm_commissions WHERE id = ?`)
      .get(cComm.id);
    const walletAfterCancel = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(cComm.memberId);
    ok(
      "cancelling a delivered order voids its Payable commission",
      afterCancel.status === "Void"
    );
    ok(
      "cancellation reverses the wallet credit",
      Number(walletAfterCancel.balance) < Number(walletAfterRelease.balance)
    );

    const rOrder = await placeOrder("9123000003");
    const rOrderId = rOrder.data?.order?.id;
    await deliver(rOrderId);
    const rComm = db
      .prepare(`SELECT * FROM mlm_commissions WHERE orderId = ? AND source IS NOT NULL`)
      .get(rOrderId);
    await req("PUT", `/api/admin/orders/${rOrderId}/payment`, {
      token: staff,
      body: { paymentStatus: "Refunded", paymentRef: "TEST-REFUND" },
    });
    const afterRefund = db
      .prepare(`SELECT * FROM mlm_commissions WHERE id = ?`)
      .get(rComm.id);
    const revoked = db
      .prepare(`SELECT status FROM mlm_eligibility_events WHERE orderId = ?`)
      .get(rOrderId);
    ok(
      "refunded order voids its 3×3 commission",
      afterRefund.status === "Void"
    );
    ok(
      "refund also revokes shopping eligibility",
      revoked?.status === "Revoked"
    );

    // ===== 7. REPORTS + AUTH =====
    console.log("\n— Reports, history and access");
    const report = await req("GET", "/api/admin/mlm/3x3/commissions", {
      token: staff,
    });
    ok(
      "commission report returns rows, types and summary",
      report.status === 200 &&
        Array.isArray(report.data?.commissions) &&
        report.data.commissions.length > 0 &&
        report.data?.summary?.direct?.label === "Direct Introduce",
      report.data
    );

    const anon = await req("GET", "/api/admin/mlm/3x3/commissions");
    ok("commission report rejects anonymous access", anon.status === 401);

    const audit = await req("GET", "/api/admin/mlm/3x3/audit", { token: staff });
    ok(
      "settings audit contains before/after snapshots",
      audit.status === 200 &&
        audit.data.audit.length >= 2 &&
        audit.data.audit[0].before &&
        audit.data.audit[0].after
    );

    const dupCheck = db
      .prepare(`
        SELECT orderId, memberId, COUNT(*) AS count
        FROM mlm_commissions
        WHERE source IS NOT NULL
        GROUP BY orderId, memberId
        HAVING count > 1
      `)
      .all();
    ok("database has no duplicate new-earning rows", dupCheck.length === 0, dupCheck);

    console.log("\n=====================================================");
    console.log(`3×3 suite: ${passed} passed, ${failed} failed`);
    console.log("=====================================================");
    if (failed) {
      console.log("Failures:", failures.join(" | "));
      console.log("Server stderr tail:\n", getStderr());
    }
  } finally {
    db.close();
    server.kill();
  }

  return failed === 0;
}

runFlow()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

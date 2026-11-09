// =====================================================
// JUSTBRAND — PAN INDIA TIME-BASED SPILLOVER PLACEMENT
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-spillover.test.mjs   (from repo root)
//
// Covers:
//   - Joining defers placement (sponsor recorded, tree position waits
//     for confirmed shopping eligibility)
//   - Pan India: members/orders from any state are eligible
//   - Max THREE direct members per parent — never a fourth
//   - Breadth-first (level-order) spillover to the next free slot
//   - Chronological placement by eligibility-confirmation time, with
//     the unique, stable orderId as the identical-timestamp tie-break
//   - Atomic/concurrency safety (simultaneous qualifying orders,
//     duplicate events, duplicate orders)
//   - Pending / cancelled / fully-refunded orders never qualify;
//     post-placement refunds revoke (audit only — no rearrangement)
//   - Preservation of existing members, placements and commission rows
//   - Authorization: admin-only endpoints, corrections need
//     super_admin + reason + audit record
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-spillover/
//   - Never touches justbrand.db at the repository root or production
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-spillover");

const PORT = Number(process.env.JB_SPILLOVER_TEST_PORT) || 4611;
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
    cwd: TMP_DIR, // justbrand.db is created HERE, isolated from production
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "jb-spillover-test-secret-local-only",
      // This suite creates the root of its own isolated tree. Public
      // production registration still requires a sponsor.
      MLM_ALLOW_ROOT_REGISTRATION: "1",
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

// Direct DB access is used ONLY for the identical-timestamp tie-break
// scenario and the legacy-data preservation scenario (throwaway DB).
const requireBackend = createRequire(path.join(REPO_ROOT, "backend", "package.json"));
const Database = requireBackend("better-sqlite3");

async function runFlow() {
  // ===== SEED: seller + KYC + approved product =====
  console.log("\n— Seed seller, staff, product");
  const reg = await req("POST", "/api/sellers/register", {
    body: {
      name: "Spill Seller",
      shopName: "Spill Shop",
      mobile: "9876500201",
      email: "spillseller@x.com",
      password: "seller123",
    },
  });
  ok("seller register accepted", reg.status === 201);

  const sLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876500201", password: "seller123" },
  });
  const seller = sLogin.data?.token;
  ok("seller login returns token", Boolean(seller));

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLogin.data?.token;
  ok("staff login returns token", Boolean(staff));

  const kyc = await req("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves seller KYC", kyc.status === 200);

  const taxReady = await onboardGstSeller(req, { sellerToken: seller, staffToken: staff });
  ok("seller PAN + GST approved", taxReady.ok, JSON.stringify(taxReady.response));

  const prod = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "Spill Product",
      category: "Electronics",
      price: "₹500",
      image: "https://cdn.example.com/spill.jpg",
    },
  });
  const productId = prod.data?.product?.id;
  ok("seller adds product", prod.status === 201 && Boolean(productId));

  const approve = await req("PUT", `/api/admin/products/${productId}/approve`, {
    token: staff,
  });
  ok("admin approves product", approve.status === 200);

  // One shopper customer places all qualifying orders; the ORDER
  // phone decides which member becomes eligible (existing rule).
  const shopper = await req("POST", "/api/customers/register", {
    body: {
      name: "Spill Shopper",
      mobile: "9100000000",
      email: "shopper@x.com",
      password: "shopper123",
    },
  });
  const shopperLogin = await req("POST", "/api/customers/login", {
    body: { mobile: "9100000000", password: "shopper123" },
  });
  const customer = shopperLogin.data?.token;
  ok("shopper customer ready", shopper.status === 201 && Boolean(customer));

  // ---------- helpers ----------
  const registerMember = async (name, mobile, referralCode) => {
    const r = await req("POST", "/api/mlm/register", {
      body: { name, mobile, password: "member123", ...(referralCode ? { referralCode } : {}) },
    });
    return r;
  };

  const place = (extra = {}) =>
    req("POST", "/api/orders", {
      token: customer,
      body: {
        items: [{ productId, quantity: 1, price: "₹500" }],
        address: "12 Spillover Street, India",
        phone: "9100000000",
        paymentMethod: "COD",
        ...extra,
      },
    });

  // Qualifying order for a member's mobile, optionally delivered.
  const orderFor = async (phone, { deliver = true, ...extra } = {}) => {
    const o = await place({ phone, ...extra });
    if (!o.data?.order?.id) return { orderId: null, order: null };
    if (deliver) {
      await req("PUT", `/api/admin/orders/${o.data.order.id}/status`, {
        token: staff,
        body: { status: "Delivered" },
      });
    }
    return { orderId: o.data.order.id, order: o.data.order };
  };

  const placementOf = async (memberId, token = staff) =>
    (await req("GET", `/api/admin/mlm/members/${memberId}/placement`, { token })).data;

  const directChildren = async (memberId) => {
    const p = await placementOf(memberId);
    return {
      count: p?.directChildrenCount,
      slots: p?.directSlots || [],
    };
  };

  // ===== 1. JOINING DEFERS PLACEMENT =====
  console.log("\n— Joining records sponsor; placement waits for eligibility");
  const R = await registerMember("Root Pan India", "9122000001");
  const rootId = R.data?.member?.memberId;
  ok("root member registered", R.status === 201 && Boolean(rootId));

  const M1 = await registerMember("Member One Kerala", "9122000011", rootId);
  const m1Id = M1.data?.member?.memberId;
  ok("sponsored member registers successfully", M1.status === 201 && Boolean(m1Id));
  ok(
    "registration does NOT place the member (placement pending)",
    !M1.data?.member?.parentId && !M1.data?.member?.position
  );
  const m1View = await placementOf(m1Id);
  ok("admin view shows unplaced member with sponsor recorded",
    m1View?.member?.placed === false && m1View?.member?.sponsorId === rootId);

  // Duplicate membership is impossible (same mobile twice).
  const dup = await registerMember("Duplicate Mobile", "9122000011", rootId);
  ok("duplicate membership rejected (same mobile)", dup.status === 409);

  // ===== 2. PAN INDIA + CHRONOLOGICAL + 3-MAX + SPILLOVER =====
  console.log("\n— Pan India, chronological BFS spillover, max 3 direct");
  const M2 = await registerMember("Member Two Maharashtra", "9122000012", rootId);
  const M3 = await registerMember("Member Three Delhi", "9122000013", rootId);
  const M4 = await registerMember("Member Four Tamil Nadu", "9122000014", rootId);
  const m2Id = M2.data?.member?.memberId;
  const m3Id = M3.data?.member?.memberId;
  const m4Id = M4.data?.member?.memberId;
  ok("four members registered across India", [M2, M3, M4].every((m) => m.status === 201));

  // Confirm eligibility in a DIFFERENT order than registration to
  // prove placement follows confirmation time, not registration time.
  await orderFor("9122000012", { city: "Pune", state: "Maharashtra", pincode: "411001" }); // M2 first
  await orderFor("9122000011", { city: "Kochi", state: "Kerala", pincode: "682016" }); // M2's order first, then M1

  const p1 = await placementOf(m1Id);
  const p2 = await placementOf(m2Id);
  ok("eligibility confirmed from any Indian state (Kerala + Maharashtra)",
    p1?.eligibilityEvents?.length === 1 && p2?.eligibilityEvents?.length === 1);
  ok(
    "placement follows CONFIRMATION order, not registration order (M2 first)",
    Number(p2?.placements?.[0]?.id) < Number(p1?.placements?.[0]?.id)
  );
  ok("both members placed under the root directly (slots A + B)",
    p1?.member?.parentId === rootId && p2?.member?.parentId === rootId &&
    [p1?.member?.position, p2?.member?.position].sort().join(",") === "A,B");

  await orderFor("9122000013", { city: "New Delhi", state: "Delhi", pincode: "110001" });
  await orderFor("9122000014", { city: "Chennai", state: "Tamil Nadu", pincode: "600001" });

  const p3 = await placementOf(m3Id);
  const p4 = await placementOf(m4Id);
  ok("third direct fills slot C under the root",
    p3?.member?.parentId === rootId && p3?.member?.position === "C");
  ok(
    "FOURTH eligible member spillovers (NOT a 4th direct of root)",
    p4?.member?.parentId !== rootId && Boolean(p4?.member?.parentId)
  );
  ok(
    "spillover follows breadth-first order (next free slot = first child of first direct)",
    p4?.member?.parentId === m1Id
  );

  const rootKids = await directChildren(rootId);
  ok("root has EXACTLY 3 direct members", rootKids.count === 3);
  ok("root direct slots are A, B, C",
    rootKids.slots.filter((s) => s.occupied).map((s) => s.slot).join(",") === "A,B,C");

  // Never a fourth direct anywhere: check every parent in both trees.
  const allPlacements = (await req("GET", "/api/admin/mlm/placements", { token: staff })).data;
  const parents = new Set(allPlacements.placements.map((p) => p.parentId).filter(Boolean));
  let maxDirectOk = true;
  for (const parent of parents) {
    const kids = await directChildren(parent);
    if (kids.count > 3) maxDirectOk = false;
  }
  ok("NO parent anywhere exceeds 3 direct members", maxDirectOk);

  // IST timestamps everywhere (one consistent reference).
  ok(
    "placement rows carry IST-displayed eligibility timestamps",
    allPlacements.placements.every((p) => / IST$/.test(p.eligibilityAtIst || ""))
  );

  // ===== 3. PENDING / CANCELLED / REFUNDED never qualify =====
  console.log("\n— Pending, cancelled, refunded eligibility rules");
  const M5 = await registerMember("Member Five Pending", "9122000015", rootId);
  const m5Id = M5.data?.member?.memberId;
  await orderFor("9122000015", { deliver: false }); // stays Pending
  const p5 = await placementOf(m5Id);
  ok("PENDING order does not qualify (member stays unplaced)",
    p5?.member?.placed === false && p5?.eligibilityEvents?.length === 0);

  const M6 = await registerMember("Member Six Cancelled", "9122000016", rootId);
  const m6Id = M6.data?.member?.memberId;
  const o6 = await orderFor("9122000016", { deliver: false });
  await req("PUT", `/api/admin/orders/${o6.orderId}/status`, {
    token: staff,
    body: { status: "Cancelled" },
  });
  const p6 = await placementOf(m6Id);
  ok("CANCELLED order does not qualify (member stays unplaced)",
    p6?.member?.placed === false && p6?.eligibilityEvents?.length === 0);

  const M7 = await registerMember("Member Seven Refunded", "9122000017", rootId);
  const m7Id = M7.data?.member?.memberId;
  const o7 = await orderFor("9122000017");
  await req("PUT", `/api/admin/orders/${o7.orderId}/status`, {
    token: staff,
    body: { status: "Refunded" },
  });
  const p7 = await placementOf(m7Id);
  ok("delivered-then-FULLY-REFUNDED: eligibility event revoked",
    p7?.eligibilityEvents?.[0]?.status === "Revoked");
  ok("refunded order's placement marked Revoked (audit only)",
    p7?.placements?.[0]?.status === "Revoked");
  ok("member is NOT rearranged or removed after refund (tree position kept)",
    Boolean(p7?.member?.parentId) &&
    ["A", "B", "C"].includes(String(p7?.member?.position || "")) &&
    p7?.placements?.[0]?.parentId === p7?.member?.parentId);

  const M8 = await registerMember("Member Eight Payment Refund", "9122000018", rootId);
  const m8Id = M8.data?.member?.memberId;
  const o8 = await orderFor("9122000018");
  const payRefund = await req("PUT", `/api/admin/orders/${o8.orderId}/payment`, {
    token: staff,
    body: { paymentStatus: "Refunded" },
  });
  const p8 = await placementOf(m8Id);
  ok("super_admin payment Refunded revokes eligibility (fully refunded)",
    payRefund.status === 200 && p8?.eligibilityEvents?.[0]?.status === "Revoked");
  const m8Commissions = (await req("GET", "/api/mlm/commissions", {
    token: (await req("POST", "/api/mlm/login", { body: { memberId: m8Id, password: "member123" } })).data?.token,
  })).data?.commissions || [];
  ok("payment refund voids the member's pending commission",
    m8Commissions.length > 0 && m8Commissions.every((c) => c.status === "Void"));

  // ===== 4. DUPLICATE EVENTS / ORDERS =====
  console.log("\n— Duplicate event and duplicate order handling");
  const M9 = await registerMember("Member Nine Duplicate", "9122000019", rootId);
  const m9Id = M9.data?.member?.memberId;
  const o9 = await orderFor("9122000019");
  // Deliver the SAME order again (duplicate event attempt).
  await req("PUT", `/api/admin/orders/${o9.orderId}/status`, {
    token: staff,
    body: { status: "Delivered" },
  });
  const dbv = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const eventsForOrder = dbv
    .prepare(`SELECT * FROM mlm_eligibility_events WHERE orderId = ?`)
    .all(o9.orderId);
  const placementsForM9 = dbv
    .prepare(`SELECT * FROM mlm_placements WHERE memberId = ?`)
    .all(m9Id);
  const dupAudit = dbv
    .prepare(
      `SELECT * FROM mlm_placement_audit WHERE memberId = ? AND action = 'duplicate-event'`
    )
    .all(m9Id);
  dbv.close();
  ok("delivering the same order twice creates ONE eligibility event",
    eventsForOrder.length === 1);
  ok("member placed exactly once despite duplicate delivery",
    placementsForM9.length === 1);
  ok("duplicate event recorded in the audit log", dupAudit.length >= 1);

  // ===== 5. IDENTICAL-TIMESTAMP TIE-BREAK =====
  console.log("\n— Identical eligibility timestamps → stable orderId tie-break");
  const S = await registerMember("Tie Root", "9122000021");
  const sId = S.data?.member?.memberId;
  const MA = await registerMember("Tie Member A", "9122000022", sId);
  const MB = await registerMember("Tie Member B", "9122000023", sId);
  const maId = MA.data?.member?.memberId;
  const mbId = MB.data?.member?.memberId;

  const oA = await orderFor("9122000022"); // earlier orderId (created first)
  const oB = await orderFor("9122000023"); // later orderId

  // Reset both to unplaced and force IDENTICAL confirmation
  // timestamps, then reprocess — the queue must fall back to orderId.
  const dbt = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  dbt.prepare(`DELETE FROM mlm_placements WHERE memberId IN (?, ?)`).run(maId, mbId);
  dbt.prepare(`UPDATE mlm_members SET parentId = NULL, position = NULL WHERE memberId IN (?, ?)`).run(maId, mbId);
  const sameTs = "2026-01-01T00:00:00.000Z";
  dbt
    .prepare(`UPDATE mlm_eligibility_events SET confirmedAt = ? WHERE orderId IN (?, ?)`)
    .run(sameTs, oA.orderId, oB.orderId);
  dbt.close();

  // Reprocess the LATER member first — chronological queue must still
  // place the EARLIER orderId first.
  const reB = await req("POST", `/api/admin/mlm/members/${mbId}/reprocess-placement`, {
    token: staff,
    body: { reason: "tie-break verification for identical eligibility timestamps" },
  });
  const pa = await placementOf(maId);
  const pb = await placementOf(mbId);
  ok("reprocess accepted (manual correction path)", reB.status === 200);
  ok(
    "identical timestamps → lower orderId placed FIRST (slot A)",
    pa?.member?.position === "A" && Number(pa?.placements?.[0]?.id) < Number(pb?.placements?.[0]?.id)
  );
  ok("second member got the next slot (B)",
    pb?.member?.position === "B" && pb?.member?.parentId === sId);

  // ===== 6. SIMULTANEOUS QUALIFYING ORDERS =====
  console.log("\n— Simultaneous qualifying orders (transaction safety)");
  const T = await registerMember("Concurrency Root", "9122000031");
  const tId = T.data?.member?.memberId;
  const concMembers = [];
  for (let i = 1; i <= 4; i++) {
    const m = await registerMember(`Concurrency Member ${i}`, `912200004${i}`, tId);
    concMembers.push(m.data?.member?.memberId);
  }
  const concOrders = [];
  for (let i = 1; i <= 4; i++) {
    const o = await place({ phone: `912200004${i}` });
    concOrders.push(o.data.order.id);
  }
  // Fire all four "Delivered" confirmations at once.
  const results = await Promise.all(
    concOrders.map((orderId) =>
      req("PUT", `/api/admin/orders/${orderId}/status`, {
        token: staff,
        body: { status: "Delivered" },
      })
    )
  );
  ok("all four concurrent deliveries processed", results.every((r) => r.status === 200));

  const db6 = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const concPlacements = concMembers.map((memberId) =>
    db6.prepare(`SELECT * FROM mlm_placements WHERE memberId = ?`).get(memberId)
  );
  const distinctPlaced = concPlacements.filter(Boolean);
  const parentCounts = db6
    .prepare(`SELECT parentId, COUNT(*) AS n FROM mlm_placements GROUP BY parentId`)
    .all();
  db6.close();
  ok("every concurrent member placed EXACTLY once (no duplicates)",
    distinctPlaced.length === 4);
  ok("no parent exceeds the 3-direct limit under concurrency",
    parentCounts.every((row) => Number(row.n) <= 3));
  const tKids = await directChildren(tId);
  ok("concurrency root got exactly 3 directs; 4th spilled over",
    tKids.count === 3 && !concPlacements.every((p) => p?.parentId === tId));

  // ===== 7. EXISTING DATA PRESERVATION =====
  console.log("\n— Existing member / commission preservation");
  const db7r = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const commissionsBefore = JSON.stringify(
    db7r.prepare(`SELECT * FROM mlm_commissions ORDER BY id`).all()
  );
  const rootRowBefore = JSON.stringify(
    db7r.prepare(`SELECT * FROM mlm_members WHERE memberId = ?`).get(rootId)
  );
  // Legacy member created by the OLD registration-time flow: already
  // placed, no sponsorId, no placement/eligibility rows.
  db7r
    .prepare(
      `INSERT INTO mlm_members (memberId, name, mobile, passwordHash, referralCode, parentId, position, status, createdAt)
       VALUES ('JBLEGACY', 'Legacy Member', '9122000099', 'legacy-hash', 'JBLEGACY', ?, 'C', 'active', ?)`
    )
    .run(rootId, new Date().toISOString());
  db7r.close();

  const M12 = await registerMember("Member Twelve New", "9122000089", rootId);
  const m12Id = M12.data?.member?.memberId;
  ok("new member registration after legacy insert works",
    M12.status === 201 && Boolean(m12Id));
  await orderFor("9122000089");
  const p12 = await placementOf(m12Id);
  ok("new member placed via spillover alongside legacy data",
    p12?.member?.placed === true && p12?.member?.parentId !== rootId);

  const db7 = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const legacyRow = db7
    .prepare(`SELECT * FROM mlm_members WHERE memberId = 'JBLEGACY'`)
    .get();
  const rootRowAfter = JSON.stringify(
    db7.prepare(`SELECT * FROM mlm_members WHERE memberId = ?`).get(rootId)
  );
  const commissionsAfter = JSON.stringify(
    db7.prepare(`SELECT * FROM mlm_commissions ORDER BY id`).all()
  );
  db7.close();
  ok("legacy member row untouched by the new system",
    legacyRow && legacyRow.parentId === rootId && legacyRow.position === "C" && !legacyRow.sponsorId);
  ok("root member row untouched (existing members preserved)",
    rootRowAfter === rootRowBefore);

  // ===== 8. AUTHORIZATION =====
  console.log("\n— Admin-only access + manual correction rules");
  const anonList = await req("GET", "/api/admin/mlm/placements");
  ok("placements list rejects anonymous (401)", anonList.status === 401);

  const memberToken = (await req("POST", "/api/mlm/login", {
    body: { memberId: rootId, password: "member123" },
  })).data?.token;
  const memberList = await req("GET", "/api/admin/mlm/placements", { token: memberToken });
  ok("placements list rejects member tokens (403)", memberList.status === 403);
  const memberDetail = await req("GET", `/api/admin/mlm/members/${rootId}/placement`, {
    token: memberToken,
  });
  ok("member placement detail rejects member tokens (403)", memberDetail.status === 403);
  const sellerList = await req("GET", "/api/admin/mlm/placements", { token: seller });
  ok("placements list rejects seller tokens (403)", sellerList.status === 403);

  const memberReprocess = await req("POST", `/api/admin/mlm/members/${m12Id}/reprocess-placement`, {
    token: memberToken,
    body: { reason: "member tries self-service reprocess" },
  });
  ok("reprocess rejects member tokens (403)", memberReprocess.status === 403);

  const noReason = await req("POST", `/api/admin/mlm/members/${m12Id}/reprocess-placement`, {
    token: staff,
    body: {},
  });
  ok("reprocess without a reason rejected (400)", noReason.status === 400);

  const unknown = await req("POST", "/api/admin/mlm/members/JBNOPE/reprocess-placement", {
    token: staff,
    body: { reason: "unknown member probe for validation" },
  });
  ok("reprocess of unknown member rejected (404)", unknown.status === 404);

  const already = await req("POST", `/api/admin/mlm/members/${m1Id}/reprocess-placement`, {
    token: staff,
    body: { reason: "already-placed member must not move" },
  });
  ok("reprocess of an already-placed member refused (409, no rearrangement)",
    already.status === 409);

  const db8 = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const auditRows = db8
    .prepare(`SELECT * FROM mlm_placement_audit WHERE action LIKE 'manual%'`)
    .all();
  db8.close();
  ok("manual corrections wrote audit records", auditRows.length >= 2);

  // ===== 9. COMMISSIONS UNTOUCHED BY ALL OF THE ABOVE =====
  // New qualifying orders may ADD new commission rows (by design),
  // but every historical row must still exist byte-identical.
  const db9 = new Database(path.join(TMP_DIR, "justbrand.db"), { fileMustExist: true });
  const finalCommissions = db9
    .prepare(`SELECT * FROM mlm_commissions ORDER BY id`)
    .all();
  db9.close();
  const beforeRows = JSON.parse(commissionsBefore);
  const afterById = new Map(finalCommissions.map((row) => [row.id, JSON.stringify(row)]));
  ok("historical commission rows never changed by spillover operations",
    beforeRows.every((row) => afterById.get(row.id) === JSON.stringify(row)));

  // ===== 10. BUYER PDP API regression (by-id endpoint) =====
  console.log("\n— Buyer PDP API regression");
  const byId = await req("GET", `/api/products/${productId}`);
  ok("approved product reachable by id for the PDP", byId.status === 200 && byId.data?.id === productId);
  const list = await req("GET", "/api/products");
  ok("product list drives the Buyer grid", Array.isArray(list.data) && list.data.length >= 1);
}

// -----------------------------------------------------
// Runner
// -----------------------------------------------------

const { server, ready, getStderr } = await startServer();

try {
  if (!ready) {
    failed++;
    console.log("✗ FAIL: backend did not become ready in time");
    console.log(getStderr());
  } else {
    await runFlow();
  }
} catch (error) {
  failed++;
  console.log(`✗ SUITE ERROR: ${error.stack || error.message}`);
  console.log(getStderr());
} finally {
  try {
    server.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

console.log(`\n=====================================================`);
console.log(`Spillover suite: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`Failures:\n  - ${failures.join("\n  - ")}`);
}
console.log(`=====================================================`);

process.exit(failed > 0 ? 1 : 0);

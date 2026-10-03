// =====================================================
// JUSTBRAND — PHASE 2: ADMIN NAV / PAYMENT SECURITY / CHAT
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-phase2.test.mjs   (from repo root)
//
// Covers:
//   1. Admin responsive navigation (source-level guarantees)
//   2. Payment authorization — super_admin-only settlement actions
//      (403 for manager/accountant/seller/anonymous), with
//      read-only financial reporting preserved where it exists.
//   3. Protected buyer ↔ seller product chat:
//      - authentication + participant authorization
//      - backend contact-info redaction (phones, spaced digits,
//        emails, WhatsApp/contact phrases)
//      - cross-seller isolation, cross-buyer isolation
//      - no seller/buyer PII in any chat response
//
// Safety: spawns the REAL backend against a THROWAWAY database in
// tests/.tmp-phase2/ — never touches justbrand.db or production.
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-phase2");

const PORT = Number(process.env.JB_PHASE2_TEST_PORT) || 4597;
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

async function src(relPath) {
  return readFile(path.join(REPO_ROOT, relPath), "utf8");
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
      JWT_SECRET: "jb-phase2-test-secret-local-only",
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
      const res = await fetch(BASE + "/");
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

// -----------------------------------------------------
// 1. ADMIN RESPONSIVE NAVIGATION (source-level)
// -----------------------------------------------------

async function runNavChecks() {
  console.log("\n— Admin responsive navigation");
  const css = await src("apps/admin-panel/src/App.css");
  const indexCss = await src("apps/admin-panel/src/index.css");
  const app = await src("apps/admin-panel/src/App.jsx");

  ok(
    "sidebar pinned below measured header height (no menu under header)",
    css.includes("top: var(--admin-header-h")
  );
  ok(
    "sidebar keeps fixed 248px dock + scrollable overflow",
    css.includes("width: 248px") && css.includes("overflow-y: auto")
  );
  ok(
    "drawer backdrop starts below header (header never overlapped)",
    css.includes(".sidebar-backdrop") &&
      /\.sidebar-backdrop \{[^}]*top: var\(--admin-header-h/s.test(css)
  );
  ok(
    "backdrop click closes the drawer (rendered onClick in App.jsx)",
    app.includes('className="sidebar-backdrop"') &&
      app.includes("setSidebarOpen(false)")
  );
  ok(
    "open drawer slides in (translateX(0)) with hidden default state",
    css.includes(".admin-sidebar.open") && css.includes("transform: translateX(0)")
  );
  ok(
    "desktop docks the sidebar (>=1024) and shows the toggle <1024",
    css.includes("(min-width: 1024px)") && css.includes("(max-width: 1023px)")
  );
  ok(
    "no horizontal page overflow (overflow-x: clip on app + body)",
    css.includes("overflow-x: clip") && indexCss.includes("overflow-x: clip")
  );
  ok(
    "content width adapts (margin-left shift + min-width guard)",
    css.includes("margin-left: 248px") && css.includes("min-width: 0")
  );
  ok(
    "header height measured at runtime (--admin-header-h set in App.jsx)",
    app.includes("--admin-header-h") && app.includes("headerRef")
  );
  ok(
    "header fallback height synchronized (sidebar, backdrop, notif all 64px — no 64/76 mismatch)",
    !/admin-header-h,\s*76px/.test(css) &&
      (css.match(/admin-header-h,\s*64px/g) || []).length >= 3
  );
  ok(
    "drawer auto-closes when viewport grows to desktop width",
    app.includes("window.innerWidth >= 1024")
  );
  ok(
    "menu selection closes the mobile drawer",
    app.includes("setSidebarOpen(false)") && app.includes("openView")
  );
  ok(
    "overview nav item still present and enabled",
    app.includes('key: "overview"') && app.includes("📊 Overview")
  );
}

// -----------------------------------------------------
// 2. PAYMENT AUTHORIZATION
// -----------------------------------------------------

async function runPaymentChecks() {
  console.log("\n— Payment security (super_admin-only settlement)");

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const admin = aLogin.data?.token;
  ok("super admin login", aLogin.status === 200 && Boolean(admin));

  // Accountant + manager staff accounts (created by super admin).
  const acctCreate = await req("POST", "/api/admin/staff", {
    token: admin,
    body: {
      name: "Phase2 Accountant",
      username: `p2acct${Date.now().toString().slice(-6)}`,
      password: "phase2pass1",
      role: "accountant",
    },
  });
  ok("accountant staff created", acctCreate.status === 200 || acctCreate.status === 201);

  const acctLogin = await req("POST", "/api/staff/login", {
    body: {
      username: acctCreate.data?.staff?.username || "",
      password: "phase2pass1",
    },
  });
  const accountant = acctLogin.data?.token;
  ok("accountant login", Boolean(accountant));

  const mgrCreate = await req("POST", "/api/admin/staff", {
    token: admin,
    body: {
      name: "Phase2 Manager",
      username: `p2mgr${Date.now().toString().slice(-6)}`,
      password: "phase2pass1",
      role: "manager",
    },
  });
  const mgrLogin = await req("POST", "/api/staff/login", {
    body: {
      username: mgrCreate.data?.staff?.username || "",
      password: "phase2pass1",
    },
  });
  const manager = mgrLogin.data?.token;
  ok("manager login", Boolean(manager));

  const mutations = [
    ["POST", "/api/admin/mlm/commissions/release", { nope: true }],
    ["PUT", "/api/admin/mlm/payouts/1", { status: "Paid" }],
    ["PUT", "/api/admin/mlm/commissions/1/paid", {}],
    ["PUT", "/api/admin/orders/1/payment", { paymentStatus: "Paid" }],
    ["PUT", "/api/admin/delivery/earnings/1/pay", {}],
  ];

  for (const [method, apiPath, body] of mutations) {
    const r = await req(method, apiPath, { token: accountant, body });
    ok(`accountant → ${method} ${apiPath} = 403`, r.status === 403, `got ${r.status}`);
  }

  for (const [method, apiPath, body] of mutations.slice(0, 2)) {
    const r = await req(method, apiPath, { token: manager, body });
    ok(`manager → ${method} ${apiPath} = 403`, r.status === 403, `got ${r.status}`);
  }

  const anon = await req("POST", "/api/admin/mlm/commissions/release", { body: {} });
  ok("anonymous → release = 401", anon.status === 401, `got ${anon.status}`);

  // Read-only financial reporting preserved for accountant.
  const rComm = await req("GET", "/api/admin/mlm/commissions", { token: accountant });
  ok("accountant keeps READ access to commission ledger", rComm.status === 200);
  const rPay = await req("GET", "/api/admin/mlm/payouts", { token: accountant });
  ok("accountant keeps READ access to payout list", rPay.status === 200);
  const rEarn = await req("GET", "/api/admin/delivery/earnings", { token: accountant });
  ok("accountant keeps READ access to delivery earnings", rEarn.status === 200);

  const mgrRead = await req("GET", "/api/admin/mlm/commissions", { token: manager });
  ok("manager still has NO access to commission ledger (unchanged)", mgrRead.status === 403);

  // super_admin settlement still works (release on empty ledger is safe).
  const rel = await req("POST", "/api/admin/mlm/commissions/release", {
    token: admin,
    body: {},
  });
  ok("super_admin → release still works (200)", rel.status === 200, `got ${rel.status}`);

  const admComm = await req("GET", "/api/admin/mlm/commissions", { token: admin });
  ok("super_admin reads commission ledger", admComm.status === 200);

  // Payment settings remain super_admin-only (already were).
  const setMgr = await req("PUT", "/api/admin/mlm/settings", {
    token: manager,
    body: { rules: {} },
  });
  ok("manager → payment/reward settings = 403", setMgr.status === 403, `got ${setMgr.status}`);

  // READ access to reward/payment settings preserved for the three
  // allowed roles (backend: requireRole("super_admin", "manager", "accountant")).
  const getAdm = await req("GET", "/api/admin/mlm/settings", { token: admin });
  ok("super_admin → GET settings = 200", getAdm.status === 200, `got ${getAdm.status}`);
  const getMgr = await req("GET", "/api/admin/mlm/settings", { token: manager });
  ok("manager keeps READ access to settings (GET 200)", getMgr.status === 200, `got ${getMgr.status}`);
  const getAcct = await req("GET", "/api/admin/mlm/settings", { token: accountant });
  ok("accountant keeps READ access to settings (GET 200)", getAcct.status === 200, `got ${getAcct.status}`);
  const getAnon = await req("GET", "/api/admin/mlm/settings");
  ok("anonymous → GET settings = 401", getAnon.status === 401, `got ${getAnon.status}`);
}

// -----------------------------------------------------
// 3. PROTECTED CHAT
// -----------------------------------------------------

async function runChatChecks() {
  console.log("\n— Protected buyer ↔ seller chat");

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const admin = aLogin.data?.token;
  ok("super admin login (chat setup)", Boolean(admin));

  // --- Seller A with an approved product ---
  const saReg = await req("POST", "/api/sellers/register", {
    body: {
      name: "Chat Seller A",
      shopName: "Alpha Trends",
      mobile: "9811111111",
      email: "sellera@example.com",
      password: "sellerpass1",
    },
  });
  ok("seller A registered", saReg.status === 201, `got ${saReg.status}`);
  const saLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9811111111", password: "sellerpass1" },
  });
  const sellerA = saLogin.data?.token;
  ok("seller A login", Boolean(sellerA));

  await req("PUT", `/api/admin/sellers/${saReg.data?.seller?.id}/kyc`, {
    token: admin,
    body: { kycStatus: "Approved" },
  });

  const prodA = await req("POST", "/api/sellers/products", {
    token: sellerA,
    body: {
      name: "Cotton Kurta Blue",
      category: "Fashion",
      price: "₹799",
      image: "https://cdn.example.com/kurta.jpg",
      shortDetails: "Chat product",
    },
  });
  ok("seller A product created", prodA.status === 201, `got ${prodA.status}`);
  const productId = prodA.data?.product?.id;
  await req("PUT", `/api/admin/products/${productId}/approve`, { token: admin });

  // --- Seller B (no products — isolation probe) ---
  const sbReg = await req("POST", "/api/sellers/register", {
    body: {
      name: "Chat Seller B",
      shopName: "Beta Styles",
      mobile: "9822222222",
      email: "sellerb@example.com",
      password: "sellerpass1",
    },
  });
  const sbLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9822222222", password: "sellerpass1" },
  });
  const sellerB = sbLogin.data?.token;
  ok("seller B login", Boolean(sellerB));

  // --- Two customers ---
  const caReg = await req("POST", "/api/customers/register", {
    body: {
      name: "Chat Buyer A",
      mobile: "9333333331",
      email: "buyera@example.com",
      password: "custpass1",
    },
  });
  ok("customer A registered", caReg.status === 201, `got ${caReg.status}`);
  const caLogin = await req("POST", "/api/customers/login", {
    body: { mobile: "9333333331", password: "custpass1" },
  });
  const buyerA = caLogin.data?.token;
  ok("customer A login", Boolean(buyerA));

  await req("POST", "/api/customers/register", {
    body: {
      name: "Chat Buyer B",
      mobile: "9333333332",
      password: "custpass1",
    },
  });
  const cbLogin = await req("POST", "/api/customers/login", {
    body: { mobile: "9333333332", password: "custpass1" },
  });
  const buyerB = cbLogin.data?.token;
  ok("customer B login", Boolean(buyerB));

  // --- Auth gates ---
  const noTok = await req("POST", "/api/chat/threads", { body: { productId } });
  ok("anonymous → open thread = 401", noTok.status === 401, `got ${noTok.status}`);

  const sellerAsBuyer = await req("POST", "/api/chat/threads", {
    token: sellerA,
    body: { productId },
  });
  ok("seller token → buyer thread route = 403", sellerAsBuyer.status === 403, `got ${sellerAsBuyer.status}`);

  const badProduct = await req("POST", "/api/chat/threads", {
    token: buyerA,
    body: { productId: 999999 },
  });
  ok("bogus product → 404", badProduct.status === 404, `got ${badProduct.status}`);

  // --- Open thread ---
  const t1 = await req("POST", "/api/chat/threads", {
    token: buyerA,
    body: { productId },
  });
  ok("buyer opens product thread (201)", t1.status === 201, `got ${t1.status}`);
  const threadId = t1.data?.thread?.id;
  ok(
    "thread carries product context (name + seller display label)",
    t1.data?.thread?.productName === "Cotton Kurta Blue" &&
      Boolean(t1.data?.thread?.displayName)
  );
  const t1Json = JSON.stringify(t1.data);
  ok(
    "thread response leaks NO seller phone/email",
    !t1Json.includes("9811111111") && !t1Json.includes("sellera@example.com")
  );

  const t2 = await req("POST", "/api/chat/threads", {
    token: buyerA,
    body: { productId },
  });
  ok("second open reuses the SAME thread", t2.data?.thread?.id === threadId);

  // --- Contact-info redaction (backend, before store/delivery) ---
  const redactionCases = [
    {
      name: "raw + spaced phone number",
      input: "Is this original? Call me at 98765 43210",
      banned: ["98765 43210", "9876543210"],
    },
    {
      name: "spaced digit groups",
      input: "my number 9 8 7 6 5 4 3 2 1 0 hai",
      banned: ["9 8 7 6 5 4 3 2 1 0", "9876543210"],
      regex: /\d(?:\s\d){8,}/,
    },
    {
      name: "standard email address",
      input: "reach me at john.doe@gmail.com",
      banned: ["john.doe", "gmail.com", "john.doe@gmail.com"],
    },
    {
      name: "email written with spaces",
      input: "mail me at john at gmail dot com",
      banned: ["john at gmail", "gmail dot"],
    },
    {
      name: "whatsapp phrase + phone",
      input: "WhatsApp me at 8765432109 for details",
      banned: ["8765432109", "whatsapp", "WhatsApp"],
    },
    {
      name: "contact-number phrase",
      input: "mera contact number 7777777777 hai",
      banned: ["7777777777", "contact number"],
    },
    {
      name: "mobile number phrase without digits",
      input: "apna mobile number bhejo",
      banned: ["mobile number"],
    },
  ];

  const deliveredFromBuyer = [];
  for (const c of redactionCases) {
    const r = await req("POST", `/api/chat/threads/${threadId}/messages`, {
      token: buyerA,
      body: { message: c.input },
    });
    const delivered = r.data?.message?.message || "";
    const hit =
      r.status === 201 &&
      c.banned.every((b) => !delivered.includes(b)) &&
      (!c.regex || !c.regex.test(delivered));
    ok(`redacts ${c.name} (backend)`, hit, `delivered="${delivered}"`);

    deliveredFromBuyer.push({ input: c.input, delivered });
  }

  // Normal product question passes through untouched.
  const normal = await req("POST", `/api/chat/threads/${threadId}/messages`, {
    token: buyerA,
    body: { message: "Is this available in blue colour and large size?" },
  });
  ok(
    "normal product question passes through unchanged",
    normal.status === 201 &&
      normal.data?.message?.message ===
        "Is this available in blue colour and large size?" &&
      normal.data?.message?.redacted === false
  );

  // Seller reply with contact info → redacted before buyer sees it.
  const sellerReply = await req("POST", `/api/chat/threads/${threadId}/messages`, {
    token: sellerA,
    body: { message: "Original quality hai, WhatsApp: 919999999999 par baat karo" },
  });
  const sellerDelivered = sellerReply.data?.message?.message || "";
  ok(
    "seller → buyer contact info also redacted",
    sellerReply.status === 201 &&
      !sellerDelivered.includes("919999999999") &&
      !sellerDelivered.toLowerCase().includes("whatsapp"),
    `delivered="${sellerDelivered}"`
  );

  // --- Delivery views ---
  const buyerView = await req("GET", `/api/chat/threads/${threadId}/messages`, {
    token: buyerA,
  });
  const buyerMsgs = buyerView.data?.messages || [];
  ok("buyer reads own thread", buyerView.status === 200 && buyerMsgs.length >= 8);
  ok(
    "buyer NEVER receives originalText (redacted only)",
    buyerView.data &&
      buyerMsgs.every((m) => !Object.prototype.hasOwnProperty.call(m, "originalText"))
  );
  const buyerJson = JSON.stringify(buyerView.data);
  ok(
    "buyer view leaks no seller phone/email",
    !buyerJson.includes("9811111111") && !buyerJson.includes("sellera@example.com")
  );
  ok(
    "no banned contact content delivered to buyer",
    deliveredFromBuyer.every(({ input }) =>
      buyerMsgs.every((m) => {
        const digits = input.match(/\d{6,}/g) || [];
        return digits.every((d) => !m.message.includes(d));
      })
    )
  );

  const sellerView = await req("GET", `/api/chat/threads/${threadId}/messages`, {
    token: sellerA,
  });
  ok("seller reads the thread", sellerView.status === 200);
  const sellerJson = JSON.stringify(sellerView.data);
  ok(
    "seller view leaks no buyer phone/email",
    !sellerJson.includes("9333333331") && !sellerJson.includes("buyera@example.com")
  );

  // --- Seller thread list (own products only) ---
  const sellerList = await req("GET", "/api/chat/threads/seller", {
    token: sellerA,
  });
  ok(
    "seller A sees exactly their product thread",
    sellerList.status === 200 &&
      (sellerList.data.threads || []).some((t) => t.id === threadId)
  );

  const buyerList = await req("GET", "/api/chat/threads", { token: buyerA });
  ok(
    "buyer A thread list contains their thread",
    buyerList.status === 200 &&
      (buyerList.data.threads || []).some((t) => t.id === threadId)
  );

  // --- Isolation ---
  const bList = await req("GET", "/api/chat/threads/seller", { token: sellerB });
  ok(
    "cross-seller isolation: seller B sees ZERO threads",
    bList.status === 200 && (bList.data.threads || []).length === 0
  );
  const bRead = await req("GET", `/api/chat/threads/${threadId}/messages`, {
    token: sellerB,
  });
  ok("cross-seller read → 404", bRead.status === 404, `got ${bRead.status}`);
  const bWrite = await req("POST", `/api/chat/threads/${threadId}/messages`, {
    token: sellerB,
    body: { message: "sneaky" },
  });
  ok("cross-seller write → 404", bWrite.status === 404, `got ${bWrite.status}`);

  const cbRead = await req("GET", `/api/chat/threads/${threadId}/messages`, {
    token: buyerB,
  });
  ok("cross-buyer read → 404", cbRead.status === 404, `got ${cbRead.status}`);
  const cbWrite = await req("POST", `/api/chat/threads/${threadId}/messages`, {
    token: buyerB,
    body: { message: "sneaky" },
  });
  ok("cross-buyer write → 404", cbWrite.status === 404, `got ${cbWrite.status}`);

  const cbList = await req("GET", "/api/chat/threads", { token: buyerB });
  ok(
    "cross-buyer list isolation",
    cbList.status === 200 &&
      !(cbList.data.threads || []).some((t) => t.id === threadId)
  );

  // --- LEGACY sellerCode-form thread (rows created before the Bug #2 fix
  // stored the numeric seller id). Directly inserts such a row, then
  // verifies list + participant access still work for both sides.
  let legacyThreadId = null;
  try {
    const { createRequire } = await import("node:module");
    const backendRequire = createRequire(
      path.join(REPO_ROOT, "backend", "package.json")
    );
    const LegacyDb = backendRequire("better-sqlite3");
    const legacyDb = new LegacyDb(path.join(TMP_DIR, "justbrand.db"));
    try {
      const sellerRow = legacyDb
        .prepare("SELECT id, sellerCode FROM sellers WHERE mobile = ?")
        .get("9811111111");
      const baseThread = legacyDb
        .prepare("SELECT buyerId FROM chat_threads WHERE id = ?")
        .get(threadId);
      const iso = new Date().toISOString();
      const info = legacyDb
        .prepare(
          `INSERT INTO chat_threads (productId, productName, buyerId, sellerId, createdAt)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          productId,
          "Legacy SellerCode Thread",
          baseThread.buyerId,
          sellerRow.sellerCode,
          iso
        );
      legacyThreadId = Number(info.lastInsertRowid);
      legacyDb
        .prepare(
          `INSERT INTO chat_messages (threadId, senderType, senderId, message, redacted, createdAt)
           VALUES (?, 'customer', ?, 'legacy thread hello', 0, ?)`
        )
        .run(legacyThreadId, String(baseThread.buyerId), iso);
    } finally {
      legacyDb.close();
    }
  } catch (err) {
    ok(`legacy sellerCode fixture insert (${err.message})`, false);
  }
  ok("legacy sellerCode-form thread inserted", Number.isInteger(legacyThreadId));

  if (Number.isInteger(legacyThreadId)) {
    const legacyList = await req("GET", "/api/chat/threads/seller", {
      token: sellerA,
    });
    ok(
      "owner seller sees LEGACY sellerCode-form thread in list",
      legacyList.status === 200 &&
        (legacyList.data.threads || []).some((t) => t.id === legacyThreadId)
    );

    const legacySellerRead = await req(
      "GET",
      `/api/chat/threads/${legacyThreadId}/messages`,
      { token: sellerA }
    );
    ok(
      "owner seller can read LEGACY sellerCode-form thread",
      legacySellerRead.status === 200 &&
        (legacySellerRead.data.messages || []).length >= 1,
      `got ${legacySellerRead.status}`
    );

    const legacyBuyerRead = await req(
      "GET",
      `/api/chat/threads/${legacyThreadId}/messages`,
      { token: buyerA }
    );
    ok(
      "buyer can read own LEGACY thread",
      legacyBuyerRead.status === 200,
      `got ${legacyBuyerRead.status}`
    );

    const legacyCross = await req(
      "GET",
      `/api/chat/threads/${legacyThreadId}/messages`,
      { token: sellerB }
    );
    ok(
      "cross-seller read of LEGACY thread → 404",
      legacyCross.status === 404,
      `got ${legacyCross.status}`
    );
  }

  // --- Validation ---
  const emptyMsg = await req("POST", `/api/chat/threads/${threadId}/messages`, {
    token: buyerA,
    body: { message: "   " },
  });
  ok("empty message → 400", emptyMsg.status === 400, `got ${emptyMsg.status}`);

  // --- Backend source guarantees ---
  const chatJs = await src("backend/chat.js");
  ok(
    "originalText is private: never selected in public reads",
    chatJs.includes("SELECT id, senderType, message, redacted, createdAt")
  );
  ok(
    "chat module uses CREATE TABLE IF NOT EXISTS only",
    chatJs.includes("CREATE TABLE IF NOT EXISTS") &&
      !/DROP\s+TABLE/i.test(chatJs)
  );
}

// -----------------------------------------------------

async function runAll() {
  await runNavChecks();
  await runPaymentChecks();
  await runChatChecks();
}

const { server, ready, getStderr } = await startServer();

try {
  if (!ready) {
    failed++;
    console.log("✗ FAIL: backend did not become ready in time");
    console.log(getStderr());
  } else {
    await runAll();
  }
} catch (err) {
  failed++;
  failures.push(`CRASH: ${err.message}`);
  console.log(`✗ CRASH: ${err.message}`);
  console.log(getStderr());
} finally {
  server.kill("SIGTERM");
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log(`\n=== PHASE 2: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failed checks:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}

// =====================================================
// JUSTBRAND — PRODUCT DETAIL PAGE API + HEADER/DISPLAY SETTINGS
//           + BANNER LIFECYCLE (additive suite)
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-pdp.test.mjs   (from repo root)
//
// Covers (Feature 1–4 backend contracts):
//   - GET /api/products/:id (new, additive): Approved-only visibility,
//     404 for pending/unknown/garbage ids, mapPublicProduct shape
//     (ordered images array + synced primary image), and a regression
//     guard that /api/products/search is NOT shadowed by the :id route.
//   - Header Appearance + display settings round-trips through the
//     admin API and the public /api/site/content feed, with 401 for
//     anonymous writes and 404 for unknown sections (compat guard).
//   - Banner lifecycle: create, edit, disable/enable, reorder,
//     delete — including MORE than seven active banners (no cap).
//   - Anonymous / unauthorized operations stay blocked.
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-pdp/ (isolated)
//   - Never touches justbrand.db at the repository root or production
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-pdp");

const PORT = Number(process.env.JB_PDP_TEST_PORT) || 4597;
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
    /* non-JSON response */
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
      // Deterministic test secret — never the production secret.
      JWT_SECRET: "jb-pdp-test-secret-local-only",
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
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { server, ready, getStderr: () => stderrTail };
}

async function runFlow() {
  // ===== A. SEED: seller + KYC + products =====
  console.log("\n— Seed seller & products");
  const reg = await req("POST", "/api/sellers/register", {
    body: {
      name: "PDP Seller",
      shopName: "PDP Shop",
      mobile: "9876500001",
      email: "pdpseller@x.com",
      password: "seller123",
    },
  });
  ok("seller register accepted", reg.status === 201);

  const sLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876500001", password: "seller123" },
  });
  ok("seller login returns token", sLogin.status === 200 && Boolean(sLogin.data?.token));
  const seller = sLogin.data?.token;

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLogin.data?.token;
  ok("staff login returns token", aLogin.status === 200 && Boolean(staff));

  const kyc = await req("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves seller KYC", kyc.status === 200);

  const taxReady = await onboardGstSeller(req, { sellerToken: seller, staffToken: staff });
  ok("seller PAN + GST approved", taxReady.ok, JSON.stringify(taxReady.response));

  // Product A: four images (the PDP gallery contract).
  const pA = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "PDP Multi Image Product",
      category: "Electronics",
      price: "₹1999",
      comparePrice: "₹2999",
      shortDetails: "Four gallery images",
      images: [
        "https://cdn.example.com/pdp1.jpg",
        "https://cdn.example.com/pdp2.jpg",
        "https://cdn.example.com/pdp3.jpg",
        "https://cdn.example.com/pdp4.jpg",
      ],
    },
  });
  ok("seller adds 4-image product", pA.status === 201);
  const aId = pA.data?.product?.id;

  // Product B: single image (legacy path).
  const pB = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "PDP Single Image Product",
      category: "Fashion",
      price: "₹499",
      image: "https://cdn.example.com/single.jpg",
    },
  });
  ok("seller adds single-image product", pB.status === 201);
  const bId = pB.data?.product?.id;

  // Product C: stays Pending (must never be visible by id).
  const pC = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "PDP Pending Product",
      category: "Home",
      price: "₹199",
      image: "https://cdn.example.com/pending.jpg",
    },
  });
  ok("seller adds pending product", pC.status === 201);
  const cId = pC.data?.product?.id;

  // Admin approves A and B only — C must stay Pending.
  const approveA = await req("PUT", `/api/admin/products/${aId}/approve`, { token: staff });
  const approveB = await req("PUT", `/api/admin/products/${bId}/approve`, { token: staff });
  ok(
    "admin approves products A and B",
    approveA.status === 200 && approveB.status === 200
  );

  // ===== B. GET /api/products/:id =====
  console.log("\n— GET /api/products/:id (PDP endpoint)");
  const byId = await req("GET", `/api/products/${aId}`);
  ok("approved product returns 200 by id", byId.status === 200 && byId.data?.id === aId);
  ok(
    "response carries ordered images array (gallery)",
    Array.isArray(byId.data?.images) && byId.data.images.length === 4
  );
  ok(
    "legacy image field synced to primary image",
    byId.data?.image === byId.data?.images?.[0]
  );
  ok("product name matches", byId.data?.name === "PDP Multi Image Product");
  ok(
    "real price fields present (price/comparePrice)",
    Boolean(byId.data?.price) && Boolean(byId.data?.comparePrice)
  );

  const byIdSingle = await req("GET", `/api/products/${bId}`);
  ok(
    "single-image product returns 200 with 1-entry gallery",
    byIdSingle.status === 200 && byIdSingle.data?.images?.length === 1
  );

  const pendingById = await req("GET", `/api/products/${cId}`);
  ok("pending product is 404 by id (approval gate)", pendingById.status === 404);

  const unknownById = await req("GET", "/api/products/99999999");
  ok("unknown id is 404", unknownById.status === 404);

  const garbageById = await req("GET", "/api/products/abc");
  ok("garbage id is 404 (never a crash)", garbageById.status === 404);

  // Regression guard: the literal /search route must not be shadowed
  // by the new /:id pattern.
  const search = await req("GET", "/api/products/search?q=PDP%20Multi");
  ok(
    "/api/products/search still works (not shadowed by :id)",
    search.status === 200 &&
      Array.isArray(search.data?.products) &&
      search.data.products.some((p) => p.id === aId)
  );

  // Buyer feed integrity: approved visible, pending hidden.
  const list = await req("GET", "/api/products");
  const listArr = Array.isArray(list.data) ? list.data : [];
  ok(
    "buyer list contains approved products only",
    listArr.some((p) => p.id === aId) &&
      listArr.some((p) => p.id === bId) &&
      !listArr.some((p) => p.id === cId)
  );

  // ===== C. AUTH / UNAUTHORIZED OPERATIONS =====
  console.log("\n— Anonymous & unauthorized operations");
  const anonLegacyPost = await req("POST", "/api/products", {
    body: { name: "Anon", category: "X", price: "₹1" },
  });
  ok("anonymous legacy product POST blocked (401)", anonLegacyPost.status === 401);

  const anonSellerPost = await req("POST", "/api/sellers/products", {
    body: { name: "Anon", category: "X", price: "₹1" },
  });
  ok("anonymous seller product POST blocked (401)", anonSellerPost.status === 401);

  const customerLogin = await req("POST", "/api/customers/register", {
    body: {
      name: "PDP Buyer",
      email: "pdpbuyer@x.com",
      mobile: "9876500002",
      password: "buyer123",
    },
  });
  const customerToken =
    customerLogin.data?.token ||
    (await req("POST", "/api/customers/login", {
      body: { email: "pdpbuyer@x.com", password: "buyer123" },
    })).data?.token;

  if (customerToken) {
    const customerSellerPost = await req("POST", "/api/sellers/products", {
      token: customerToken,
      body: { name: "Customer", category: "X", price: "₹1" },
    });
    ok(
      "customer token cannot submit seller products (401/403)",
      customerSellerPost.status === 401 || customerSellerPost.status === 403
    );
    const customerApprove = await req("PUT", `/api/admin/products/${cId}/approve`, {
      token: customerToken,
    });
    ok(
      "customer token cannot approve products (401/403)",
      customerApprove.status === 401 || customerApprove.status === 403
    );
  } else {
    ok("customer register/login returned a token", false);
  }

  // ===== D. HEADER + DISPLAY SETTINGS PERSISTENCE =====
  console.log("\n— Header Appearance & display settings round-trips");
  const anonHeader = await req("PUT", "/api/admin/site/settings/header", {
    body: { content: { logoHeight: 44 } },
  });
  ok(
    "anonymous header-settings write blocked (401/403)",
    anonHeader.status === 401 || anonHeader.status === 403
  );

  const headerContent = {
    logoWidth: 90,
    logoHeight: 45,
    logoPosition: "left",
    nameFontSize: 30,
    cartIconSize: 28,
    headerHeight: 72,
    lockAspect: true,
  };
  const hPut = await req("PUT", "/api/admin/site/settings/header", {
    token: staff,
    body: { content: headerContent },
  });
  ok("staff saves header settings", hPut.status === 200 && hPut.data?.success === true);

  const feed1 = await req("GET", "/api/site/content");
  ok(
    "public feed serves saved header settings",
    feed1.data?.content?.header?.logoHeight === 45 &&
      feed1.data?.content?.header?.nameFontSize === 30
  );

  const dPut = await req("PUT", "/api/admin/site/settings/display", {
    token: staff,
    body: { content: { bannerFit: "contain" } },
  });
  ok("staff saves display settings", dPut.status === 200 && dPut.data?.success === true);

  const feed2 = await req("GET", "/api/site/content");
  ok(
    "public feed serves saved display.bannerFit",
    feed2.data?.content?.display?.bannerFit === "contain"
  );

  const adminSettings = await req("GET", "/api/admin/site/settings", { token: staff });
  ok(
    "admin settings endpoint returns header + display sections",
    adminSettings.data?.settings?.header?.logoWidth === 90 &&
      adminSettings.data?.settings?.display?.bannerFit === "contain"
  );

  // Persistence across re-reads (what the Buyer load path does).
  const feed3 = await req("GET", "/api/site/content");
  ok(
    "settings persist across repeated reads (refresh safety)",
    feed3.data?.content?.header?.logoWidth === 90 &&
      feed3.data?.content?.display?.bannerFit === "contain"
  );

  const unknownSection = await req("PUT", "/api/admin/site/settings/not-a-section", {
    token: staff,
    body: { content: { x: 1 } },
  });
  ok("unknown settings section still 404 (compat guard)", unknownSection.status === 404);

  // ===== E. BANNER LIFECYCLE (incl. MORE than seven) =====
  console.log("\n— Banner lifecycle (create/edit/reorder/disable/delete, 8 banners)");
  const anonBanner = await req("POST", "/api/admin/site/banners", {
    body: { title: "Anon Banner" },
  });
  ok(
    "anonymous banner create blocked (401/403)",
    anonBanner.status === 401 || anonBanner.status === 403
  );

  const bannerIds = [];
  for (let i = 1; i <= 8; i++) {
    const created = await req("POST", "/api/admin/site/banners", {
      token: staff,
      body: {
        title: `PDP Banner ${i}`,
        subtitle: `Subtitle ${i}`,
        ctaText: i === 1 ? "Shop Now" : "",
        ctaLink: i === 1 ? "/products" : "",
        imageUrl: `https://cdn.example.com/banner${i}.jpg`,
        sortOrder: i - 1,
      },
    });
    if (created.status === 201) bannerIds.push(created.data?.id);
  }
  ok("staff created 8 banners (no 6/7 cap)", bannerIds.length === 8);

  const feedB1 = await req("GET", "/api/site/content");
  const publicBanners1 = feedB1.data?.content?.banners || [];
  ok(
    "public feed shows all 8 active banners",
    publicBanners1.filter((b) => String(b.title || "").startsWith("PDP Banner")).length === 8
  );

  // EDIT (title/image/CTA) on banner 1.
  const edit = await req("PUT", `/api/admin/site/banners/${bannerIds[0]}`, {
    token: staff,
    body: {
      title: "PDP Banner 1 Edited",
      ctaText: "Grab Deal",
      ctaLink: "/deals",
      imageUrl: "https://cdn.example.com/banner1-edited.jpg",
    },
  });
  ok("staff edits banner fields", edit.status === 200 && edit.data?.success === true);

  const feedB2 = await req("GET", "/api/site/content");
  const edited = (feedB2.data?.content?.banners || []).find(
    (b) => b.id === bannerIds[0]
  );
  ok(
    "edited banner values visible on public feed",
    edited?.title === "PDP Banner 1 Edited" &&
      edited?.ctaText === "Grab Deal" &&
      edited?.imageUrl === "https://cdn.example.com/banner1-edited.jpg"
  );

  // REORDER: move banner 2 to position 0 and banner 1 to position 1.
  await req("PUT", `/api/admin/site/banners/${bannerIds[1]}`, {
    token: staff,
    body: { sortOrder: 0 },
  });
  await req("PUT", `/api/admin/site/banners/${bannerIds[0]}`, {
    token: staff,
    body: { sortOrder: 1 },
  });
  const feedB3 = await req("GET", "/api/site/content");
  const pdpFeed = (feedB3.data?.content?.banners || []).filter((b) =>
    String(b.title || "").startsWith("PDP Banner")
  );
  ok(
    "reorder rewrites display order on public feed",
    pdpFeed[0]?.id === bannerIds[1] && pdpFeed[1]?.id === bannerIds[0]
  );

  // DISABLE → hidden from public, kept in admin list.
  const disable = await req("PUT", `/api/admin/site/banners/${bannerIds[0]}`, {
    token: staff,
    body: { active: false },
  });
  ok("staff disables banner", disable.status === 200 && disable.data?.success === true);

  const feedB4 = await req("GET", "/api/site/content");
  const activePdp = (feedB4.data?.content?.banners || []).filter((b) =>
    String(b.title || "").startsWith("PDP Banner")
  );
  ok(
    "disabled banner hidden from public feed (7 remain)",
    activePdp.length === 7 && !activePdp.some((b) => b.id === bannerIds[0])
  );

  const adminList1 = await req("GET", "/api/admin/site/settings", { token: staff });
  ok(
    "disabled banner kept in admin list (inactive)",
    (adminList1.data?.banners || []).some(
      (b) => b.id === bannerIds[0] && b.active === false
    )
  );

  // ENABLE again → back on the public feed.
  await req("PUT", `/api/admin/site/banners/${bannerIds[0]}`, {
    token: staff,
    body: { active: true },
  });
  const feedB5 = await req("GET", "/api/site/content");
  const activeAgain = (feedB5.data?.content?.banners || []).filter((b) =>
    String(b.title || "").startsWith("PDP Banner")
  );
  ok("re-enabled banner returns to public feed (8 again)", activeAgain.length === 8);

  // DELETE the last banner → gone from both lists.
  const del = await req("DELETE", `/api/admin/site/banners/${bannerIds[7]}`, {
    token: staff,
  });
  ok("staff deletes banner", del.status === 200 && del.data?.success === true);

  const feedB6 = await req("GET", "/api/site/content");
  const afterDelete = feedB6.data?.content?.banners || [];
  const adminList2 = await req("GET", "/api/admin/site/settings", { token: staff });
  ok(
    "deleted banner gone from public feed and admin list",
    !afterDelete.some((b) => b.id === bannerIds[7]) &&
      !(adminList2.data?.banners || []).some((b) => b.id === bannerIds[7])
  );

  // Invalid banner payload → 400 (safe delete/validation behavior).
  const badBanner = await req("POST", "/api/admin/site/banners", {
    token: staff,
    body: { title: "" },
  });
  ok("invalid banner payload rejected (400)", badBanner.status === 400);
}

// -----------------------------------------------------

const { server, ready, getStderr } = await startServer();

if (!ready) {
  console.error("✗ Backend failed to start on test port.");
  console.error(getStderr());
  rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
}

try {
  await runFlow();
} catch (error) {
  failed++;
  failures.push(`suite crashed: ${error.message}`);
  console.error("✗ Suite crashed:", error);
} finally {
  server.kill();
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log(`\n=== PDP + SETTINGS + BANNERS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

// =====================================================
// JUSTBRAND — PHASE 1: SITE CMS + CATEGORIES + TERMINOLOGY
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-site-cms.test.mjs   (from repo root)
//
// Covers:
//   - site_settings: new additive keys (footer/policies/delivery/
//     family/reward) written by admin and served through the public
//     /api/site/content feed (round-trip), with null defaults when
//     nothing is saved yet (Buyer fallback safety).
//   - Categories: admin CRUD WITHOUT delete (deactivate only),
//     2-level max (top-level + sub-categories), public
//     GET /api/categories returning only active categories with
//     nested children, usage hints (productCount) for safe UX.
//   - Buyer category fallback: source-level checks that the
//     hardcoded fallback chips/list remain in the Buyer app.
//   - Reward / JustBrand Family terminology: customer-facing
//     display strings renamed; internals (API routes, tables,
//     route keys, protected SellerDashboard.jsx) untouched.
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-cms/ (isolated)
//   - Never touches justbrand.db at the repository root or production
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-cms");

const PORT = Number(process.env.JB_SITE_CMS_TEST_PORT) || 4595;
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

async function src(relPath) {
  return readFile(path.join(REPO_ROOT, relPath), "utf8");
}

// -----------------------------------------------------
// Start the real backend against a throwaway database
// -----------------------------------------------------

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const server = spawn(
    process.execPath,
    [BACKEND_ENTRY],
    {
      cwd: TMP_DIR, // justbrand.db is created HERE, isolated from production
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(PORT),
        // Deterministic test secret — never the production secret.
        JWT_SECRET: "jb-site-cms-test-secret-local-only",
      },
    }
  );

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  server.stdout.on("data", () => {});

  // Wait for readiness by polling the health endpoint (no fixed sleep).
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

// -----------------------------------------------------
// The Phase 1 flow
// -----------------------------------------------------

async function runFlow() {
  // ===== A. PUBLIC SITE CONTENT FEED (additive keys) =====
  console.log("\n— Site settings (public feed)");
  const feed0 = await req("GET", "/api/site/content");
  ok("public site content feed responds", feed0.status === 200 && feed0.data?.success === true);
  const c0 = feed0.data?.content || {};
  ok(
    "feed exposes footer/policies/deliveryInfo/familyInfo/rewardInfo keys",
    ["footer", "policies", "deliveryInfo", "familyInfo", "rewardInfo"].every(
      (k) => Object.prototype.hasOwnProperty.call(c0, k)
    )
  );
  ok(
    "unconfigured sections are null (Buyer keeps hardcoded defaults)",
    c0.footer === null &&
      c0.policies === null &&
      c0.deliveryInfo === null &&
      c0.familyInfo === null &&
      c0.rewardInfo === null
  );
  ok("existing keys still present (about/contact/branding/homepage/banners)",
    ["about", "contact", "branding", "homepage", "banners"].every(
      (k) => Object.prototype.hasOwnProperty.call(c0, k)
    )
  );

  // ===== B. ADMIN AUTH =====
  console.log("\n— Admin auth");
  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLogin.data?.token;
  ok("staff login returns token", aLogin.status === 200 && Boolean(staff));

  const noAuth = await req("PUT", "/api/admin/site/settings/footer", {
    body: { content: { active: true } },
  });
  ok(
    "settings write blocked without a staff token",
    noAuth.status === 401 || noAuth.status === 403
  );

  // ===== C. SETTINGS ROUND-TRIPS =====
  console.log("\n— Settings round-trips (footer/policies/delivery/family/reward)");

  const footerBody = {
    content: {
      heading: "JustBrand Test",
      description: "Footer description under test",
      aboutText: "About JB",
      contactText: "Contact JB",
      returnPolicyText: "Returns & Refunds",
      deliveryPolicyText: "Shipping Info",
      privacyText: "Privacy",
      termsText: "Terms",
      familyText: "JustBrand Family",
      copyright: "© TEST 2026",
      showFamily: true,
      active: true,
    },
  };
  const fPut = await req("PUT", "/api/admin/site/settings/footer", {
    token: staff,
    body: footerBody,
  });
  ok("admin saves footer section", fPut.status === 200 && fPut.data?.success === true);

  const feed1 = await req("GET", "/api/site/content");
  ok(
    "footer round-trips to the public feed",
    feed1.data?.content?.footer?.heading === "JustBrand Test" &&
      feed1.data?.content?.footer?.aboutText === "About JB"
  );

  const polPut = await req("PUT", "/api/admin/site/settings/policies", {
    token: staff,
    body: {
      content: {
        returnsTitle: "Return Policy",
        returnsText: "Admin-managed returns copy.",
        shippingTitle: "Shipping Policy",
        shippingText: "Admin-managed shipping copy.",
        privacyTitle: "Privacy Policy",
        privacyText: "Admin-managed privacy copy.",
        termsTitle: "Terms",
        termsText: "Admin-managed terms copy.",
        active: true,
      },
    },
  });
  ok("admin saves policies section", polPut.status === 200 && polPut.data?.success === true);

  const delPut = await req("PUT", "/api/admin/site/settings/delivery", {
    token: staff,
    body: {
      content: {
        heading: "Delivery Information",
        description: "Fast delivery PAN India",
        timeline: "3–7 business days",
        support: "delivery@justbrand.in",
        policyText: "Extra delivery policy text.",
        active: true,
      },
    },
  });
  ok("admin saves delivery section", delPut.status === 200 && delPut.data?.success === true);

  const famPut = await req("PUT", "/api/admin/site/settings/family", {
    token: staff,
    body: {
      content: {
        heading: "JustBrand Family",
        intro: "Family introduction under test",
        howItWorks: "Refer and grow",
        treeExplanation: "Direct + spillover placement",
        additionalInfo: "",
        active: true,
      },
    },
  });
  ok("admin saves family section", famPut.status === 200 && famPut.data?.success === true);

  const rewPut = await req("PUT", "/api/admin/site/settings/reward", {
    token: staff,
    body: {
      content: {
        heading: "Rewards & Benefits",
        explanation: "Earn rewards on every eligible order",
        rules: "Reward rules copy",
        levelInfo: "Level-wise reward copy",
        active: true,
      },
    },
  });
  ok("admin saves reward section", rewPut.status === 200 && rewPut.data?.success === true);

  const feed2 = await req("GET", "/api/site/content");
  const c2 = feed2.data?.content || {};
  ok(
    "policies round-trip to the public feed",
    c2.policies?.returnsText === "Admin-managed returns copy." &&
      c2.policies?.privacyText === "Admin-managed privacy copy."
  );
  ok(
    "delivery info round-trips to the public feed",
    c2.deliveryInfo?.heading === "Delivery Information" &&
      c2.deliveryInfo?.timeline === "3–7 business days"
  );
  ok(
    "family info round-trips to the public feed",
    c2.familyInfo?.intro === "Family introduction under test"
  );
  ok(
    "reward info round-trips to the public feed",
    c2.rewardInfo?.heading === "Rewards & Benefits" &&
      c2.rewardInfo?.explanation === "Earn rewards on every eligible order"
  );

  const adminSettings = await req("GET", "/api/admin/site/settings", { token: staff });
  const s = adminSettings.data?.settings || {};
  ok(
    "admin settings endpoint returns all new sections",
    ["footer", "policies", "delivery", "family", "reward"].every((k) =>
      Object.prototype.hasOwnProperty.call(s, k)
    ) && adminSettings.data?.banners !== undefined
  );
  ok(
    "existing admin settings keys unchanged",
    ["about", "contact", "homepage", "branding"].every((k) =>
      Object.prototype.hasOwnProperty.call(s, k)
    )
  );

  const unknown = await req("PUT", "/api/admin/site/settings/not-a-section", {
    token: staff,
    body: { content: {} },
  });
  ok("unknown section rejected with 404", unknown.status === 404);

  // ===== D. CATEGORIES =====
  console.log("\n— Categories / sub-categories (additive, non-destructive)");

  const freshCats = await req("GET", "/api/categories");
  ok(
    "public categories endpoint responds with an empty list initially",
    freshCats.status === 200 &&
      freshCats.data?.success === true &&
      Array.isArray(freshCats.data?.categories) &&
      freshCats.data.categories.length === 0
  );

  const catNoAuth = await req("POST", "/api/admin/categories", {
    body: { name: "Sneaky" },
  });
  ok(
    "category create blocked without a staff token",
    catNoAuth.status === 401 || catNoAuth.status === 403
  );

  const cFashion = await req("POST", "/api/admin/categories", {
    token: staff,
    body: { name: "Fashion", icon: "👕", sortOrder: 2, active: true },
  });
  ok("admin creates top-level category", cFashion.status === 201 && Boolean(cFashion.data?.id));

  const cElectronics = await req("POST", "/api/admin/categories", {
    token: staff,
    body: { name: "Electronics", icon: "📱", sortOrder: 1, active: true },
  });
  ok("admin creates second top-level category", cElectronics.status === 201);

  const cSub = await req("POST", "/api/admin/categories", {
    token: staff,
    body: { name: "Men's Shirts", parentId: cFashion.data?.id, active: true },
  });
  ok("admin creates sub-category under a parent", cSub.status === 201 && Boolean(cSub.data?.id));

  const tooDeep = await req("POST", "/api/admin/categories", {
    token: staff,
    body: { name: "Too Deep", parentId: cSub.data?.id },
  });
  ok("3rd-level nesting rejected (2 levels max)", tooDeep.status === 400);

  const noName = await req("POST", "/api/admin/categories", {
    token: staff,
    body: { name: "   " },
  });
  ok("empty category name rejected", noName.status === 400);

  const adminList = await req("GET", "/api/admin/categories", { token: staff });
  const adminCats = adminList.data?.categories || [];
  ok(
    "admin list includes usage hints (productCount / subCategoryCount)",
    adminList.status === 200 &&
      adminCats.length === 3 &&
      adminCats.every(
        (c) => typeof c.active === "boolean" && typeof c.productCount === "number"
      )
  );
  ok(
    "top-level reports its sub-category count",
    adminCats.find((c) => c.name === "Fashion")?.subCategoryCount === 1
  );

  const pub1 = await req("GET", "/api/categories");
  const pubCats = pub1.data?.categories || [];
  ok("public list has only top-level categories", pubCats.length === 2);
  ok(
    "public list sorted by sortOrder (Electronics first)",
    pubCats[0]?.name === "Electronics"
  );
  const pubFashion = pubCats.find((c) => c.name === "Fashion");
  ok(
    "sub-category nested under its parent",
    (pubFashion?.children || []).some((ch) => ch.name === "Men's Shirts")
  );

  const rename = await req("PUT", `/api/admin/categories/${cFashion.data?.id}`, {
    token: staff,
    body: { name: "Fashion & Lifestyle" },
  });
  ok("admin renames category", rename.status === 200 && rename.data?.success === true);

  const reorder = await req("PUT", `/api/admin/categories/${cElectronics.data?.id}`, {
    token: staff,
    body: { sortOrder: 50 },
  });
  ok("admin changes sort order", reorder.status === 200);

  const pub2 = await req("GET", "/api/categories");
  const pub2Cats = pub2.data?.categories || [];
  ok(
    "rename + reorder reflected publicly",
    pub2Cats[0]?.name === "Fashion & Lifestyle" && pub2Cats[1]?.name === "Electronics"
  );

  const offSub = await req("PUT", `/api/admin/categories/${cSub.data?.id}`, {
    token: staff,
    body: { active: false },
  });
  const pub3 = await req("GET", "/api/categories");
  const pub3Fashion = (pub3.data?.categories || []).find(
    (c) => c.name === "Fashion & Lifestyle"
  );
  ok(
    "deactivating a sub-category hides it (no delete needed)",
    offSub.status === 200 && (pub3Fashion?.children || []).length === 0
  );

  const offTop = await req("PUT", `/api/admin/categories/${cElectronics.data?.id}`, {
    token: staff,
    body: { active: false },
  });
  const pub4 = await req("GET", "/api/categories");
  ok(
    "deactivating a top-level category hides it from buyers",
    offTop.status === 200 && (pub4.data?.categories || []).length === 1
  );

  const delCat = await req("DELETE", `/api/admin/categories/${cFashion.data?.id}`, {
    token: staff,
  });
  ok("no destructive DELETE endpoint for categories (404)", delCat.status === 404);

  const stillThere = await req("GET", "/api/admin/categories", { token: staff });
  ok(
    "category still exists after delete attempt",
    (stillThere.data?.categories || []).length === 3
  );

  const selfParent = await req("PUT", `/api/admin/categories/${cFashion.data?.id}`, {
    token: staff,
    body: { parentId: cFashion.data?.id },
  });
  ok("self-parenting rejected", selfParent.status === 400);

  // ===== E. EXISTING APIS STILL WORK =====
  console.log("\n— Backward compatibility");
  const products = await req("GET", "/api/products");
  ok("public products feed unchanged and reachable", products.status === 200);

  // ===== F. BUYER FALLBACK (source-level) =====
  console.log("\n— Buyer category fallback + content consumption (source checks)");
  const buyerApp = await src("apps/buyer-app/src/App.jsx");
  ok(
    "buyer keeps hardcoded fallback category chips",
    buyerApp.includes("FALLBACK_CATEGORY_CHIPS") &&
      buyerApp.includes('"Electronics"') &&
      buyerApp.includes('"Fashion"') &&
      buyerApp.includes('"Grocery"')
  );
  ok(
    "buyer fetches /api/categories with fallback path",
    buyerApp.includes("/api/categories")
  );
  ok("buyer wires footer content into <Footer", buyerApp.includes("content={siteContent?.footer"));

  const buyerCat = await src("apps/buyer-app/src/components/Category.jsx");
  ok(
    "Category.jsx keeps the 6-item hardcoded fallback list",
    buyerCat.includes("FALLBACK_CATEGORIES") &&
      buyerCat.includes("👕 Fashion") &&
      buyerCat.includes("💻 Computers")
  );

  const buyerFooter = await src("apps/buyer-app/src/components/Footer.jsx");
  ok(
    "footer consumes admin content with hardcoded fallbacks",
    buyerFooter.includes("content") &&
      buyerFooter.includes('"JustBrand"') &&
      buyerFooter.includes('onInfoPage?.("shipping")') &&
      buyerFooter.includes('onInfoPage?.("privacy")') &&
      buyerFooter.includes('onInfoPage?.("terms")')
  );

  const buyerInfo = await src("apps/buyer-app/src/pages2/InfoPages.jsx");
  ok(
    "buyer info pages expose shipping/privacy/terms",
    ["shipping", "privacy", "terms"].every((k) => buyerInfo.includes(`${k}:`)) ||
      (buyerInfo.includes("shipping:") && buyerInfo.includes("privacy:") && buyerInfo.includes("terms:"))
  );
  ok(
    "built-in Returns page preserved as fallback",
    buyerInfo.includes("Eligibility for Return") &&
      buyerInfo.includes("ReturnsPage({ policies })")
  );

  const sellerAdd = await src("apps/seller-app/src/pages/AddProduct.jsx");
  ok(
    "seller AddProduct keeps free-text category with API suggestions",
    sellerAdd.includes('list="jb-category-suggestions"') &&
      sellerAdd.includes("/api/categories")
  );

  // ===== G. REWARD / JUSTBRAND FAMILY TERMINOLOGY =====
  console.log("\n— Reward + JustBrand Family terminology (customer-facing only)");
  const bannedPairs = [
    ["apps/buyer-app/src/Pages/MLMCommissionRules.jsx", ["Family Commission Rules", "Save Commission Rules"]],
    ["apps/buyer-app/src/Pages/MLMCommission.jsx", ["Commission Center", "Commission History", "No Commission Found"]],
    ["apps/buyer-app/src/Pages/MLMWallet.jsx", ["Withdraw Commission", "Pending Commission", "Commission Types"]],
    ["apps/seller-app/src/pages/MLMCommissionRules.jsx", ["MLM Commission Rules", "Save Commission Rules"]],
    ["apps/seller-app/src/pages/MLMCommission.jsx", ["MLM Commission", "Commission History", "No Commission Found"]],
    ["apps/seller-app/src/pages/MLMWallet.jsx", ["MLM Wallet", "Withdraw Commission", "Commission Types"]],
    ["apps/seller-app/src/pages/MLMDashboard.jsx", ["MLM Dashboard", "MLM MENU", "MLM Wallet"]],
    ["apps/seller-app/src/pages/MLMTree.jsx", ["MLM Network", "Shopping Commission"]],
    ["apps/admin-panel/src/App.jsx", ["Commission Settings", "Level-wise Commission"]],
    ["apps/admin-panel/src/Business.jsx", ["Commission Rules (admin-configurable)", "Release Due Commissions"]],
    ["apps/admin-panel/src/FamilyManagers.jsx", ["Level-wise Commission"]],
  ];
  for (const [file, banned] of bannedPairs) {
    const text = await src(file);
    const still = banned.filter((b) => text.includes(b));
    ok(
      `${file}: no leftover customer-facing "${banned[0]}" style strings`,
      still.length === 0
    );
  }

  const buyerRules = await src("apps/buyer-app/src/Pages/MLMCommissionRules.jsx");
  ok(
    "buyer rules page uses Reward wording",
    buyerRules.includes("Family Reward Rules") && buyerRules.includes("Save Reward Rules")
  );
  const sellerDash = await src("apps/seller-app/src/pages/MLMDashboard.jsx");
  ok(
    "seller dashboard uses JustBrand Family wording",
    sellerDash.includes("JustBrand Family") && sellerDash.includes("Family Wallet")
  );

  // ===== H. INTERNALS + PROTECTED FILES UNTOUCHED =====
  console.log("\n— Internals & protected files");
  const businessJs = await src("backend/business.js");
  ok(
    "backend still exposes /api/mlm/commissions internals",
    businessJs.includes("/api/mlm/commissions") &&
      businessJs.includes("releaseDueCommissions") &&
      businessJs.includes("mlm_commissions")
  );
  const serverJs = await src("backend/server.js");
  ok(
    "mlm_commissions index/table references intact in server.js",
    serverJs.includes("mlm_commissions")
  );
  const adminApp = await src("apps/admin-panel/src/App.jsx");
  ok(
    "admin route keys unchanged (fam-commission / fam-levels)",
    adminApp.includes('"fam-commission"') && adminApp.includes('"fam-levels"')
  );
  const sellerDashProtected = await src("apps/seller-app/src/pages/SellerDashboard.jsx");
  ok(
    "protected SellerDashboard.jsx keeps its original MLM labels",
    sellerDashProtected.includes('text="MLM Dashboard"') &&
      sellerDashProtected.includes('text="MLM Commission"')
  );
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
} catch (err) {
  failed++;
  failures.push(`CRASH: ${err.message}`);
  console.log(`✗ CRASH: ${err.message}`);
  console.log(getStderr());
} finally {
  server.kill("SIGTERM");
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log(`\n=== SITE CMS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failed checks:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}

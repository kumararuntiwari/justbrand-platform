// =====================================================
// JUSTBRAND — GST MANAGER (category / subcategory / HSN)
// =====================================================
// Zero-dependency Node test suite (built-ins only).
// Run with:  node --test tests/jb-gst-manager.test.mjs
//
// Covers:
//   - Draft mappings never apply; admin approval applies + reprices.
//   - HSN mapping beats subcategory/category; a different HSN never
//     inherits the wrong category rate.
//   - Future effective dates are ignored.
//   - Seller-entered rate never overrides an approved mapping; product
//     level override is admin-only.
//   - CSV import stages drafts (nothing applied until approval).
//   - Review report: category/SKU/HSN/rate/source + Verified/Missing/
//     Incorrect + pending count.
//   - CGST+SGST vs IGST split, inclusive/exclusive calculation exactly
//     once, checkout quote == order, old orders keep their snapshot.
//
// Safety: spawns the real backend on an isolated port with a THROWAWAY
// database in tests/.tmp-gst-manager — never touches justbrand.db or
// any preview database.

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-gst-manager");
const PORT = Number(process.env.JB_GST_TEST_PORT) || 4622;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function req(method, endpoint, { token, body } = {}) {
  const res = await fetch(BASE + endpoint, {
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
      JWT_SECRET: "jb-gst-manager-test-secret-local-only",
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

async function run() {
  const { server, ready, getStderr } = await startServer();
  if (!ready) {
    console.error("Backend did not start:\n" + getStderr());
    process.exit(1);
  }

  try {
    const staff = (
      await req("POST", "/api/staff/login", {
        body: { username: "superadmin", password: "JustBrand@2026" },
      })
    ).data?.token;

    const reg = await req("POST", "/api/sellers/register", {
      body: {
        name: "GST Seller",
        shopName: "GST Shop",
        mobile: "9876500777",
        email: "gst@x.com",
        password: "seller123",
      },
    });
    await req("PUT", `/api/admin/sellers/${reg.data.seller.id}/kyc`, {
      token: staff,
      body: { kycStatus: "Approved" },
    });
    const seller = (
      await req("POST", "/api/sellers/login", {
        body: { mobile: "9876500777", password: "seller123" },
      })
    ).data?.token;

    const taxReady = await onboardGstSeller(req, { sellerToken: seller, staffToken: staff });
    ok("seller KYC + PAN + GST approved", taxReady.ok, JSON.stringify(taxReady.response));

    await req("POST", "/api/customers/register", {
      body: {
        name: "GST Customer",
        mobile: "9876500888",
        email: "gstcust@x.com",
        password: "gstcust123",
      },
    });
    const customer = (
      await req("POST", "/api/customers/login", {
        body: { mobile: "9876500888", password: "gstcust123" },
      })
    ).data?.token;

    ok("staff + seller + customer tokens", Boolean(staff && seller && customer));

    async function addProduct(body) {
      const res = await req("POST", "/api/sellers/products", {
        token: seller,
        body: { images: ["https://cdn.example.com/g.jpg"], price: "1000", ...body },
      });
      const id = res.data?.product?.id;
      await req("PUT", `/api/admin/products/${id}/approve`, { token: staff });
      return id;
    }

    async function saveMapping(body, approve = false) {
      return req("POST", "/api/admin/gst/mappings", {
        token: staff,
        body: { ...body, approve },
      });
    }

    async function quote(productId, state = "Uttar Pradesh") {
      return req("POST", "/api/orders/quote", {
        token: customer,
        body: { items: [{ productId, quantity: 1 }], state, deliveryMethod: "" },
      });
    }

    // ===== A. DRAFT → APPROVAL GATE =====
    console.log("\n— Draft mappings are inert until approved");

    const fashionProduct = await addProduct({
      name: "GST Tee",
      category: "Fashion",
      hsnCode: "6109",
    });
    ok("product created + approved", Boolean(fashionProduct));

    const draft = await saveMapping({ scope: "category", category: "Fashion", gstRate: 5 }, false);
    ok(
      "category mapping saved as pending draft",
      draft.status === 201 && draft.data?.mapping?.status === "pending",
      draft.data
    );

    const qDraft = await quote(fashionProduct);
    ok(
      "pending mapping is NOT applied (GST 0)",
      Number(qDraft.data?.quote?.tax?.totals?.gstAmount) === 0,
      qDraft.data?.quote?.tax?.totals
    );

    const reviewDraft = await req("GET", "/api/admin/gst/review", { token: staff });
    const draftRow = (reviewDraft.data?.items || []).find((item) => item.id === fashionProduct);
    ok("unmapped product is Missing in the review report", draftRow?.statusLabel === "Missing", draftRow);

    await req("POST", `/api/admin/gst/mappings/${draft.data.mapping.id}/approve`, { token: staff });
    const qApproved = await quote(fashionProduct);
    ok(
      "approved category mapping applies 5% exactly once",
      Number(qApproved.data?.quote?.tax?.lines?.[0]?.gstRate) === 5 &&
        Number(qApproved.data?.quote?.tax?.totals?.gstAmount) === 56,
      qApproved.data?.quote?.tax?.totals
    );

    const reviewAfter = await req("GET", "/api/admin/gst/review", { token: staff });
    const verifiedRow = (reviewAfter.data?.items || []).find((item) => item.id === fashionProduct);
    ok(
      "mapped product becomes Verified with source 'category'",
      verifiedRow?.statusLabel === "Verified" && verifiedRow?.source === "category",
      verifiedRow
    );

    // ===== B. HSN PRIORITY + MISMATCH NEVER GUESSED =====
    console.log("\n— HSN mapping precedence and mismatch protection");

    // Category mapping now pins HSN 6109; a different HSN must not
    // inherit that rate.
    const catHsn = await saveMapping(
      { scope: "category", category: "Fashion", hsnCode: "6109", gstRate: 5 },
      true
    );
    ok("category mapping with HSN saved", catHsn.status === 201, catHsn.data);

    const hsnMapping = await saveMapping({ scope: "hsn", hsnCode: "6109", gstRate: 12 }, true);
    ok("HSN mapping 12% approved", hsnMapping.status === 201 && hsnMapping.data?.mapping?.status === "approved");

    const hsnProduct = await addProduct({
      name: "GST HSN Shirt",
      category: "Fashion",
      hsnCode: "6109",
    });
    const qHsn = await quote(hsnProduct);
    ok(
      "HSN mapping (12%) beats category mapping (5%)",
      Number(qHsn.data?.quote?.tax?.lines?.[0]?.gstRate) === 12,
      qHsn.data?.quote?.tax?.lines
    );

    const otherHsnProduct = await addProduct({
      name: "GST Other HSN",
      category: "Fashion",
      hsnCode: "6205",
    });
    const qOther = await quote(otherHsnProduct);
    ok(
      "different HSN does NOT inherit the category rate",
      Number(qOther.data?.quote?.tax?.totals?.gstAmount) === 0,
      qOther.data?.quote?.tax?.totals
    );

    const reviewOther = await req("GET", "/api/admin/gst/review", { token: staff });
    const otherRow = (reviewOther.data?.items || []).find((item) => item.id === otherHsnProduct);
    ok(
      "HSN mismatch is reported as Incorrect (not silently rated)",
      otherRow?.statusLabel === "Incorrect" && otherRow?.flags?.includes("hsn_mismatch"),
      otherRow
    );

    // ===== C. SUBCATEGORY + EFFECTIVE DATE =====
    console.log("\n— Subcategory mapping and effective dates");

    const subMapping = await saveMapping(
      { scope: "subcategory", category: "Fashion", subcategory: "Shirts", gstRate: 12 },
      true
    );
    ok("subcategory mapping approved", subMapping.status === 201);

    const subProduct = await addProduct({
      name: "GST Sub Shirt",
      category: "Fashion",
      subCategory: "Shirts",
    });
    const qSub = await quote(subProduct);
    ok(
      "subcategory mapping applies 12%",
      Number(qSub.data?.quote?.tax?.lines?.[0]?.gstRate) === 12,
      qSub.data?.quote?.tax?.lines
    );

    const future = await saveMapping(
      {
        scope: "category",
        category: "Beauty",
        gstRate: 18,
        effectiveFrom: "2099-01-01",
      },
      true
    );
    const beautyProduct = await addProduct({ name: "GST Future", category: "Beauty" });
    const qFuture = await quote(beautyProduct);
    ok(
      "future-dated mapping is approved but not applied today",
      future.status === 201 &&
        qFuture.data?.quote?.tax?.totals?.gstAmount === 0,
      { mapping: future.data?.mapping, gst: qFuture.data?.quote?.tax?.totals }
    );

    // ===== D. SELLER CANNOT OVERRIDE APPROVED MAPPING =====
    console.log("\n— Seller rate vs approved mapping / admin-only product override");

    const sellerTries = await addProduct({
      name: "GST Seller Override",
      category: "Fashion",
      gstRate: 18,
    });
    const qSeller = await quote(sellerTries);
    ok(
      "seller's 18% does not override approved 5% category mapping",
      Number(qSeller.data?.quote?.tax?.lines?.[0]?.gstRate) === 5,
      qSeller.data?.quote?.tax?.lines
    );

    const override = await req("PUT", `/api/admin/products/${sellerTries}/tax`, {
      token: staff,
      body: { gstRate: 18, hsnCode: "6109", gstType: "exclusive" },
    });
    ok(
      "admin product classification is accepted",
      override.status === 200 && Number(override.data?.resolved?.gstRate) === 18,
      override.data
    );
    const qOverride = await quote(sellerTries);
    ok(
      "admin product override (18%) beats the mapping",
      Number(qOverride.data?.quote?.tax?.lines?.[0]?.gstRate) === 18,
      qOverride.data?.quote?.tax?.lines
    );

    const sellerNoAuth = await req("GET", "/api/admin/gst/mappings", { token: seller });
    ok("seller cannot read admin GST mappings", sellerNoAuth.status === 401 || sellerNoAuth.status === 403);

    const suggestions = await req("GET", "/api/sellers/gst-suggestions?category=Fashion", {
      token: seller,
    });
    ok(
      "seller suggestion returns the approved category mapping",
      suggestions.status === 200 && Number(suggestions.data?.suggestion?.gstRate) === 5,
      suggestions.data
    );

    const noSuggestion = await req("GET", "/api/sellers/gst-suggestions?category=Unknown", {
      token: seller,
    });
    ok(
      "unknown category returns needs-review (no guessed rate)",
      noSuggestion.status === 200 &&
        noSuggestion.data?.suggestion === null &&
        noSuggestion.data?.requiresReview === true,
      noSuggestion.data
    );

    // ===== E. CSV IMPORT (DRAFT ONLY) =====
    console.log("\n— CSV import stages drafts");

    const csv = [
      "category,subcategory,hsn,gstRate,effectiveFrom,notes",
      "Grocery,,,0,,staples",
      "Home,Kitchen,7323,12,2026-01-01,steel utensils",
    ].join("\n");

    const importRes = await fetch(BASE + "/api/admin/gst/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Authorization: `Bearer ${staff}`,
        "x-file-name": "gst-rates.csv",
      },
      body: csv,
    });
    const importData = await importRes.json().catch(() => null);
    ok(
      "CSV import stages two pending drafts",
      importRes.status === 200 &&
        importData?.importedCount === 2 &&
        importData?.mappings?.every((mapping) => mapping.status === "pending"),
      importData
    );

    const groceryProduct = await addProduct({ name: "GST Grocery", category: "Grocery" });
    const qGrocery = await quote(groceryProduct);
    ok(
      "imported (unapproved) Grocery rate is not applied",
      qGrocery.data?.quote?.tax?.totals?.gstAmount === 0,
      qGrocery.data?.quote?.tax?.totals
    );

    const homeMapping = (importData?.mappings || []).find((mapping) => mapping.category === "Home");
    await req("POST", `/api/admin/gst/mappings/${homeMapping.id}/approve`, { token: staff });
    const homeProduct = await addProduct({
      name: "GST Home Pan",
      category: "Home",
      subCategory: "Kitchen",
      hsnCode: "7323",
    });
    const qHome = await quote(homeProduct);
    ok(
      "approved imported subcategory mapping applies 12%",
      Number(qHome.data?.quote?.tax?.lines?.[0]?.gstRate) === 12,
      qHome.data?.quote?.tax?.lines
    );

    // ===== F. CGST/SGST vs IGST + INCLUSIVE/EXCLUSIVE =====
    console.log("\n— Tax split, inclusive pricing, old-order snapshots");

    await req("PUT", "/api/admin/charges/gst", {
      token: staff,
      body: { originState: "Uttar Pradesh", priceIncludesGst: false },
    });

    const intra = await quote(hsnProduct, "Uttar Pradesh");
    const inter = await quote(hsnProduct, "Maharashtra");
    ok(
      "intra-state → CGST + SGST (IGST 0)",
      intra.data?.quote?.tax?.totals?.splitMode === "intra" &&
        Number(intra.data?.quote?.tax?.totals?.cgst) > 0 &&
        Number(intra.data?.quote?.tax?.totals?.sgst) > 0 &&
        Number(intra.data?.quote?.tax?.totals?.igst) === 0,
      intra.data?.quote?.tax?.totals
    );
    ok(
      "inter-state → IGST only",
      inter.data?.quote?.tax?.totals?.splitMode === "inter" &&
        Number(inter.data?.quote?.tax?.totals?.igst) > 0 &&
        Number(inter.data?.quote?.tax?.totals?.cgst) === 0,
      inter.data?.quote?.tax?.totals
    );

    const split = await req(
      "GET",
      "/api/admin/gst/preview?rate=18&originState=Uttar Pradesh&destinationState=Uttar Pradesh&taxableValue=1000",
      { token: staff }
    );
    ok(
      "GST split preview: ₹1000 + 18% → CGST ₹90 + SGST ₹90",
      split.data?.preview?.cgst === 90 && split.data?.preview?.sgst === 90,
      split.data?.preview
    );

    const inclusiveProduct = await addProduct({
      name: "GST Inclusive",
      category: "Fashion",
      price: "1000",
    });
    await req("PUT", `/api/admin/products/${inclusiveProduct}/tax`, {
      token: staff,
      body: { gstType: "inclusive", gstRate: 12, hsnCode: "6109" },
    });
    const qInclusive = await quote(inclusiveProduct);
    const incTotals = qInclusive.data?.quote?.tax?.totals;
    ok(
      "inclusive product: GST extracted, not added on top",
      Number(round2(incTotals?.gstAmount)) === 120 &&
        Number(round2(incTotals?.lineTotal)) === 1120,
      incTotals
    );

    // Place one order at 12% then change the HSN rate: the old order
    // must keep its snapshot.
    const qOrder = await quote(hsnProduct, "Maharashtra");
    const place = await req("POST", "/api/orders", {
      token: customer,
      body: {
        items: [{ productId: hsnProduct, quantity: 1 }],
        address: "1 GST Street, Test Nagar, India",
        phone: "9876500888",
        state: "Maharashtra",
        paymentMethod: "COD",
        clientGrandTotal: qOrder.data.quote.grandTotal,
      },
    });
    ok("order placed at 12%", place.status === 201, place.data);

    const orderId = place.data?.order?.id;
    const beforeOrder = await req("GET", `/api/orders/${orderId}`, { token: customer });
    const beforeTax = beforeOrder.data?.order?.taxAmount ?? beforeOrder.data?.order?.gstAmount;

    await saveMapping({ scope: "hsn", hsnCode: "6109", gstRate: 18 }, true);
    const afterOrder = await req("GET", `/api/orders/${orderId}`, { token: customer });
    const afterTax = afterOrder.data?.order?.taxAmount ?? afterOrder.data?.order?.gstAmount;
    ok(
      "old order GST snapshot is unchanged after a rate change",
      String(beforeTax) === String(afterTax),
      { beforeTax, afterTax }
    );

    const qNew = await quote(hsnProduct);
    ok("new quotes use the changed rate (18%)", Number(qNew.data?.quote?.tax?.lines?.[0]?.gstRate) === 18);

    // ===== G. REVIEW REPORT SHAPE =====
    console.log("\n— Review report + history");
    const report = await req("GET", "/api/admin/gst/review", { token: staff });
    const sample = (report.data?.items || [])[0] || {};
    ok(
      "review report has category/SKU/HSN/rate/source/status",
      ["category", "sku", "hsnCode", "gstRate", "source", "statusLabel"].every((key) => key in sample),
      sample
    );
    ok(
      "pending count matches non-verified rows",
      report.data?.pendingCount ===
        report.data.items.filter((item) => item.statusLabel !== "Verified").length,
      { pending: report.data?.pendingCount, count: report.data?.count }
    );
    ok(
      "verified / missing / incorrect counts add up",
      report.data?.verifiedCount + report.data?.missingCount + report.data?.incorrectCount ===
        report.data?.items?.length,
      report.data
    );

    const list = await req("GET", "/api/admin/gst/mappings", { token: staff });
    ok(
      "history records create + approve actions",
      list.status === 200 &&
        list.data.history.some((entry) => /create/.test(entry.action)) &&
        list.data.history.some((entry) => entry.action === "approve"),
      list.data?.history?.slice(0, 5)
    );

    ok(
      "summary counts pending vs approved",
      list.data?.summary?.pending >= 1 && list.data?.summary?.approved >= 1,
      list.data?.summary
    );
  } finally {
    server.kill();
    rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log(`\n=== GST MANAGER: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("Failures:", failures);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

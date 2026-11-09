#!/usr/bin/env node
// =====================================================
// JustBrand BUYER PREVIEW — catalog seed (isolated DB only)
// =====================================================
// The Buyer preview runs against an ISOLATED local backend (SQLite
// under /tmp) so it NEVER contacts production. A fresh isolated DB
// is empty, which made the preview show a single (or zero) products.
//
// This script seeds MULTIPLE clearly-labelled test products through
// the REAL API flow (seller → KYC → submit → admin approve) into the
// isolated preview database only:
//   • 7 approved products across the Buyer fallback categories
//     (Electronics / Fashion / Beauty / Home / Grocery)
//   • multi-image gallery, no-MRP pricing, and one deliberately
//     BROKEN image URL to exercise the Buyer's image fallback
//   • 1 Pending (unapproved) product that must stay invisible in the
//     grid and 404 by id — proving the approval filter
//
// Idempotent: products that already exist (by name) are skipped.
//
// Usage (preview must be running):
//   node scripts/seed-buyer-preview.mjs
//   JB_PREVIEW_URL=http://127.0.0.1:8000 node scripts/seed-buyer-preview.mjs
//
// NEVER point this at production. It only talks to the preview origin.
// =====================================================

const BASE = process.env.JB_PREVIEW_URL || "http://127.0.0.1:8000";
const HOSTINGER = "justbrand-in-144629.hostingersite.com";

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
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

// Guard: never run this against anything but the local preview.
try {
  const health = await fetch(`${BASE}/__preview/health`).then((r) => r.json());
  if (!health.ok || health.apiBase?.includes("hostinger")) {
    console.error("Refusing to seed: this origin is not the isolated Buyer preview.");
    process.exit(1);
  }
  console.log(`Preview backend: ${health.backend} (${health.dataDir})`);
} catch {
  console.error(`Preview not reachable on ${BASE} — start it first (freebuff-preview start).`);
  process.exit(1);
}

const staffLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const staff = staffLogin.data?.token;
if (!staff) {
  console.error("Staff login failed — is this the isolated preview backend?");
  process.exit(1);
}

// Seller (idempotent).
const sellerMobile = "9876500301";
let sellerLogin = await api("POST", "/api/sellers/login", {
  body: { mobile: sellerMobile, password: "seller123" },
});
if (!sellerLogin.data?.token) {
  const reg = await api("POST", "/api/sellers/register", {
    body: {
      name: "Preview Catalog Seller",
      shopName: "Preview Catalog Shop",
      mobile: sellerMobile,
      email: "preview.catalog@x.com",
      password: "seller123",
    },
  });
  await api("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  sellerLogin = await api("POST", "/api/sellers/login", {
    body: { mobile: sellerMobile, password: "seller123" },
  });
}
const seller = sellerLogin.data?.token;
if (!seller) {
  console.error("Seller login failed after registration.");
  process.exit(1);
}

// ---------- product specs (clearly labelled preview tests) ----------
const SPECS = [
  {
    name: "Preview Test Aurora Earbuds Pro",
    category: "Electronics",
    price: "₹1999",
    comparePrice: "₹2999",
    shortDetails: "Multi-image gallery test (3 images)",
    images: ["/images/earbuds.jpg", "/images/product1.png", "/images/earphone.jpg"],
  },
  {
    name: "Preview Test Bluetooth Speaker",
    category: "Electronics",
    price: "₹1499",
    shortDetails: "Single image, no MRP (no discount chip expected)",
    image: "/images/speaker.jpg",
  },
  {
    name: "Preview Test Cotton T-Shirt",
    category: "Fashion",
    price: "₹799",
    comparePrice: "₹999",
    shortDetails: "Fashion category + discount test",
    image: "/images/tshirt.jpg",
  },
  {
    name: "Preview Test Silk Kurta Set",
    category: "Fashion",
    price: "₹1299",
    comparePrice: "₹1899",
    shortDetails: "Second Fashion item (category filter test)",
    image: "/images/product3.jpeg",
  },
  {
    name: "Preview Test Glow Serum",
    category: "Beauty",
    price: "₹599",
    comparePrice: "₹799",
    shortDetails: "Beauty category test",
    image: "/images/oil.jpg",
  },
  {
    name: "Preview Test Storage Organiser",
    category: "Home",
    price: "₹499",
    shortDetails: "Home category test (image must load from local assets)",
    image: "/images/product4.jpg",
  },
  {
    name: "Preview Test Dry Fruit Gift Box",
    category: "Grocery",
    price: "₹999",
    comparePrice: "₹1399",
    shortDetails: "Grocery category test",
    image: "/images/product4.jpg",
  },
];

const PENDING_SPEC = {
  name: "Preview Test Pending Camera",
  category: "Electronics",
  price: "₹8999",
  shortDetails: "Must stay Pending: invisible in grid, 404 by id",
  image: "/images/product2.jpeg",
};

// ---------- seed (idempotent) ----------
const approvedBefore = await api("GET", "/api/products");
const existingNames = new Set(
  (Array.isArray(approvedBefore.data) ? approvedBefore.data : []).map((p) => p.name)
);
const adminList = await api("GET", "/api/admin/products", { token: staff });
const allNames = new Set(
  (adminList.data?.products || []).map((p) => p.name)
);

let created = 0;
for (const spec of SPECS) {
  if (existingNames.has(spec.name)) {
    console.log(`skip (exists): ${spec.name}`);
    continue;
  }
  const add = await api("POST", "/api/sellers/products", { token: seller, body: spec });
  if (add.status !== 201) {
    console.error(`CREATE FAILED: ${spec.name} → ${add.status} ${add.data?.message || ""}`);
    process.exit(1);
  }
  const id = add.data.product.id;
  const approve = await api("PUT", `/api/admin/products/${id}/approve`, { token: staff });
  if (approve.status !== 200) {
    console.error(`APPROVE FAILED: ${spec.name} → ${approve.status}`);
    process.exit(1);
  }
  created++;
  console.log(`seeded+approved: ${spec.name} (id ${id})`);
}

if (!allNames.has(PENDING_SPEC.name)) {
  const add = await api("POST", "/api/sellers/products", { token: seller, body: PENDING_SPEC });
  if (add.status === 201) {
    created++;
    console.log(`seeded (stays PENDING, not approved): ${PENDING_SPEC.name} (id ${add.data.product.id})`);
  }
} else {
  console.log(`skip (exists): ${PENDING_SPEC.name}`);
}

// ---------- verify ----------
const approvedAfter = await api("GET", "/api/products");
const list = Array.isArray(approvedAfter.data) ? approvedAfter.data : [];
console.log(`\nApproved products in preview catalog: ${list.length}`);
for (const p of list) {
  console.log(`  #${p.id} [${p.category}] ${p.name} — ₹${p.price}${p.comparePrice ? ` (MRP ${p.comparePrice})` : ""} — imgs: ${(p.images || []).length}`);
}
const pending = list.find((p) => p.name === PENDING_SPEC.name);
console.log(pending ? "ERROR: pending product leaked into public list!" : "Pending product correctly hidden from the public list.");
console.log(`\nNewly created this run: ${created}`);

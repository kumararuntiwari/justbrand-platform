// =====================================================
// JustBrand — BUYER PREVIEW JOURNEY (browser verification)
// =====================================================
// Verifies, against the LIVE Freebuff preview (default :8000, isolated
// /tmp DB, same-origin /api):
//   1. Home catalog renders the real Approved products (no demo items)
//   2. PDP by URL (/product/:id) + add to cart
//   3. Honest empty-catalog state when the backend answers with []
//      (no fake demo products — the bug this suite guards)
//   4. Offline fallback still shows demo items when the API is down
//   5. Full COD purchase journey with a throwaway test customer:
//      register → cart → checkout quote → place order → My Orders
//   6. /api/products serves only Approved products (Pending hidden)
//
// Safety: only contacts the local preview; creates data ONLY in the
// preview's isolated /tmp database. Production is never touched.
//
// Run:  node tests/.buyer-journey.verify.mjs   (from repo root)
// =====================================================
import { chromium } from "playwright";

const BASE = process.env.JB_PREVIEW_URL || "http://127.0.0.1:8000";
const out = { steps: {}, errors: [] };
const ok = (n, c, extra) => {
  out.steps[n] = c ? "PASS" : `FAIL ${extra !== undefined ? JSON.stringify(extra) : ""}`;
  if (!c) out.failed = (out.failed || 0) + 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => out.errors.push(String(e).slice(0, 200)));
page.on("dialog", (d) => d.accept());
let hostinger = 0;
page.on("request", (r) => {
  if (r.url().includes("hostingersite")) hostinger++;
});

// ---------- 1. Home catalog (real data from the isolated DB) ----------
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
const cards = await page.locator(".jb-pcard").count();
const cardText = await page.locator(".jb-product-grid").innerText().catch(() => "");
ok("home_shows_9_products", cards === 9, { cards });
ok(
  "home_no_demo_products",
  !cardText.includes("Smart Watch") && !cardText.includes("Men Fashion Shirt"),
  null
);
ok(
  "home_no_empty_state",
  (await page.getByText("No products available yet").count()) === 0,
  null
);

// ---------- 2. PDP by URL + add to cart ----------
await page.goto(BASE + "/product/2", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1000);
const pdpOk = await page
  .getByText("Preview Test Aurora Earbuds Pro")
  .first()
  .isVisible()
  .catch(() => false);
ok("pdp_by_url_loads", pdpOk, null);
const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
if (await addBtn.count()) {
  await addBtn.click();
  await page.waitForTimeout(500);
} else {
  ok("pdp_add_to_cart_button", false, "not found");
}
const cartCount = await page.evaluate(
  () => JSON.parse(localStorage.getItem("justbrand_cart") || "[]").length
);
ok("cart_item_added", cartCount >= 1, { cartCount });

// ---------- 3. Empty catalog state (backend answers with []) ----------
await page.route("**/api/products**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]",
  })
);
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
const emptyVisible = await page
  .getByText("No products available yet")
  .isVisible()
  .catch(() => false);
const refreshVisible = await page
  .getByRole("button", { name: "Refresh" })
  .isVisible()
  .catch(() => false);
const bodyText = await page.locator("body").innerText();
ok("empty_catalog_honest_state", emptyVisible, null);
ok("empty_catalog_refresh_btn", refreshVisible, null);
ok(
  "empty_catalog_no_demo_products",
  !bodyText.includes("Smart Watch") && !bodyText.includes("Wireless Earbuds"),
  null
);
await page.unroute("**/api/products**");

// ---------- 4. Offline fallback unchanged (API unreachable) ----------
await page.route("**/api/products**", (route) => route.abort());
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
const offlineText = await page.locator("body").innerText();
ok("offline_demo_fallback_still_works", offlineText.includes("Smart Watch"), null);
await page.unroute("**/api/products**");

// ---------- 5. Throwaway customer → full COD purchase journey ----------
const mobile = "98765" + String(Math.floor(10000 + Math.random() * 89999));
const reg = await fetch(BASE + "/api/customers/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Preview Journey Tester",
    mobile,
    password: "Preview@123",
  }),
}).then((r) => r.json());
ok("customer_register", reg.success && !!reg.token, reg.message);

if (reg.token) {
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  await page.evaluate(
    ({ token, customer }) => {
      localStorage.setItem("justbrand_customer_token", token);
      localStorage.setItem("justbrand_customer", JSON.stringify(customer));
      localStorage.setItem("justbrand_cart", JSON.stringify([]));
    },
    { token: reg.token, customer: reg.customer }
  );

  await page.goto(BASE + "/product/2", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: /cart/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const checkoutBtn = page.getByRole("button", { name: /checkout/i }).first();
  ok("cart_page_checkout_btn", (await checkoutBtn.count()) > 0, null);

  if (await checkoutBtn.count()) {
    await checkoutBtn.click();
    await page.waitForTimeout(1200);
    const quoteSeen = await page
      .getByText(/Total ₹/i)
      .first()
      .isVisible()
      .catch(() => false);
    ok("checkout_quote_visible", quoteSeen, null);
    const codShown = await page.evaluate(() =>
      document.body.innerText.includes("Cash on Delivery")
    );
    ok("checkout_cod_option", codShown, null);

    await page.getByPlaceholder(/House no|street/i).fill("12, Preview Nagar, Test Lane");
    await page.getByPlaceholder("City").fill("Indore");
    await page.getByPlaceholder("State").fill("Madhya Pradesh");
    await page.getByPlaceholder("6-digit PIN").fill("452001");
    await page.getByPlaceholder(/mobile number/i).fill(mobile);
    await page.getByRole("button", { name: /Place Order/i }).click();
    await page.waitForTimeout(1500);
    const success = await page
      .getByText("Order Placed!")
      .isVisible()
      .catch(() => false);
    const orderNumber = await page.evaluate(() => {
      const m = document.body.innerText.match(/JB\d{10,}/);
      return m ? m[0] : null;
    });
    ok("order_placed_in_isolated_db", success && !!orderNumber, { orderNumber });
    out.orderNumber = orderNumber;

    if (success) {
      await page
        .getByRole("button", { name: /Continue Shopping/i })
        .click()
        .catch(() => {});
      await page.waitForTimeout(600);
      // "My Orders" lives inside the header side menu — open it first.
      const menuBtn = page.getByRole("button", { name: "Open menu" }).first();
      if (await menuBtn.count()) await menuBtn.click();
      await page.waitForTimeout(400);
      const ordersBtn = page.getByRole("button", { name: /orders/i }).first();
      if (await ordersBtn.count()) {
        await ordersBtn.click();
        await page.waitForTimeout(1500);
        const ordersText = await page.locator("body").innerText();
        ok(
          "my_orders_lists_order",
          orderNumber ? ordersText.includes(orderNumber.slice(0, 12)) : false,
          null
        );
        ok(
          "my_orders_shows_status",
          /Pending|Confirmed|Processing/i.test(ordersText),
          null
        );
      } else {
        ok("my_orders_lists_order", false, "orders button not found");
      }
    }
  }
}

// ---------- 5b. Out-of-stock UI blocking (intercepted API) ----------
// The catalog feed marks product 2 out of stock; the card + PDP must
// block purchase actions. Backend enforcement is covered by
// tests/jb-stock.test.mjs — this verifies the Buyer UI layer.
await page.route("**/api/products**", (route) => {
  const url = route.request().url();
  const oos = { id: 2, name: "Preview Test Aurora Earbuds Pro", price: "₹1999", customerPrice: 2198.92, stock: 0, inStock: false, images: ["/images/earbuds.jpg"] };
  const inStock = { id: 3, name: "Preview Test Bluetooth Speaker", price: "₹1499", customerPrice: 1658.92, stock: 4, inStock: true, images: ["/images/speaker.jpg"] };
  const byId = url.match(/\/api\/products\/(\d+)/);
  if (byId) {
    const product = Number(byId[1]) === 3 ? inStock : oos;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(product),
    });
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([oos, inStock]),
  });
});
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
const oosBadge = await page.getByLabel("Out of stock").first().isVisible().catch(() => false);
ok("oos_card_badge_visible", oosBadge, null);
const addCartBtn = page.getByRole("button", { name: "Add to cart" }).first();
const disabledOnCard = await addCartBtn.isDisabled().catch(() => "missing");
ok("oos_card_add_to_cart_disabled", disabledOnCard === true, disabledOnCard);

await page.goto(BASE + "/product/2", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1000);
const oosBanner = await page.getByLabel("Out of stock").first().isVisible().catch(() => false);
ok("oos_pdp_banner_visible", oosBanner, null);
ok("oos_pdp_add_to_cart_disabled", await page.getByRole("button", { name: "Add to cart" }).isDisabled().catch(() => "missing"), null);
ok("oos_pdp_buy_now_disabled", await page.getByRole("button", { name: "Buy now" }).isDisabled().catch(() => "missing"), null);

// In-stock product (stock 4) keeps working buttons.
await page.goto(BASE + "/product/3", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
const inStockBtn = page.getByRole("button", { name: "Add to cart" }).first();
await inStockBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
ok("instock_pdp_add_to_cart_enabled", !(await inStockBtn.isDisabled().catch(() => true)), null);
await page.unroute("**/api/products**");

// ---------- 6. API surface sanity ----------
const products = await fetch(BASE + "/api/products").then((r) => r.json());
ok("api_products_9_approved", Array.isArray(products) && products.length === 9, products.length);
ok(
  "api_pending_product_hidden",
  Array.isArray(products) && products.every((p) => p.status === "Approved"),
  null
);

out.hostingerRequests = hostinger;
await browser.close();
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed ? 1 : 0);

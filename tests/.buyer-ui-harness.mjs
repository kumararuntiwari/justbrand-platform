// =====================================================
// JUSTBRAND — HEADLESS BUYER UI REPRO HARNESS (dev-only)
// =====================================================
// Drives the Buyer preview in headless Chromium over CDP and reports
// rendered state + JS exceptions. Used to reproduce/verify the blank
// Product Details page report. Not part of the production build.
//
// Usage: node tests/.buyer-ui-harness.mjs   (preview must be running)
// =====================================================
import { spawn } from "node:child_process";

const CHROME =
  "/home/daytona/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const PORT = Number(process.env.JB_CDP_PORT) || 9333;
const BASE = process.env.JB_BASE || "http://127.0.0.1:8000";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

spawn(
  CHROME,
  [
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/jb-chrome-profile-${Date.now()}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

let list = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    list = await r.json();
    if (list.find((t) => t.type === "page")) break;
  } catch {
    /* not up yet */
  }
  await sleep(250);
}
const target = (list || []).find((t) => t.type === "page");
if (!target) {
  console.log("FATAL: no page target");
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
let events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  // Auto-accept alert()/confirm() dialogs — headless Chromium blocks
  // the renderer on an unhandled dialog, which looks like a frozen page.
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(
      JSON.stringify({
        id: ++id,
        method: "Page.handleJavaScriptDialog",
        params: { accept: true },
      })
    );
    return;
  }
  events.push(m);
};
function send(method, params = {}) {
  return new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        res({ timeout: true, method });
      }
    }, 10000);
  });
}
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

async function navigate(url, waitMs = 5000) {
  events = [];
  await send("Page.navigate", { url });
  await sleep(waitMs);
}
async function js(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails)
    return { EXC: r.result.exceptionDetails.text };
  return r.result?.result?.value;
}
function pageErrors() {
  const out = [];
  for (const m of events) {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      out.push(
        "EXCEPTION: " +
          (d.exception?.description || d.text).split("\n").slice(0, 4).join(" | ")
      );
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      out.push("LOG.ERROR: " + m.params.entry.text.slice(0, 300));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      out.push(
        "CONSOLE.ERROR: " +
          m.params.args
            .map((a) => a.value ?? a.description ?? "")
            .join(" ")
            .slice(0, 300)
      );
    }
  }
  return [...new Set(out)];
}

const SNAP = `JSON.stringify({
  href: location.pathname + location.search,
  textLen: (document.body.innerText || "").length,
  h1: (document.querySelector("h1")?.innerText || "").slice(0, 80),
  cards: document.querySelectorAll(".jb-pcard").length,
  addToCart: [...document.querySelectorAll("button")].some(b => b.innerText.includes("Add to Cart")),
  notFound: (document.body.innerText || "").includes("Product not found"),
  loading: (document.body.innerText || "").includes("Loading product"),
  errCard: (document.body.innerText || "").includes("Could not load"),
  pwInputs: document.querySelectorAll('input[type="password"]').length,
  checkoutBtn: [...document.querySelectorAll("button")].some(b=>/checkout/i.test(b.innerText)),
  sample: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 240),
})`;

async function report(label) {
  console.log(`\n### ${label}`);
  console.log("state:", await js(SNAP));
  const errs = pageErrors();
  console.log("errors:", errs.length ? JSON.stringify(errs, null, 1) : "none");
}

// ---- Scenario 1: homepage → click first product card ----
await navigate(`${BASE}/`);
await report("1a. homepage");
await js(`document.querySelector(".jb-pcard")?.click(); "clicked"`);
await sleep(3500);
await report("1b. after clicking first product card");

// ---- Scenario 2: direct PDP URL ----
await navigate(`${BASE}/product/1`);
await report("2. direct /product/1");

// ---- Scenario 3: PDP → Add to Cart → cart button ----
await js(
  `[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Add to Cart"))?.click(); "ok"`
);
await sleep(800);
await js(
  `document.querySelector(".jb-cart-btn")?.click(); "ok"`
);
await sleep(1200);
await report("3. PDP + add-to-cart + header cart button");

// ---- Scenario 4: PDP → Buy Now (auth/checkout branch shadowing?) ----
await navigate(`${BASE}/product/1`);
await js(
  `[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Buy Now"))?.click(); "ok"`
);
await sleep(1500);
await report("4. after Buy Now on /product/1");

// ---- Scenario 5: catalog verification (isolated preview DB) ----
// Grid must equal the API's approved list (real DB rows — never the
// built-in demo fallback), category chips must filter, PDP must open
// for a non-first product, and a broken image URL must fall back.
await navigate(`${BASE}/`);
await sleep(1500);
const catalog = await js(`(async () => {
  const list = await fetch("/api/products").then(r => r.json());
  const gridText = document.body.innerText || "";
  const cards = [...document.querySelectorAll(".jb-pcard")];
  const fashionBtn = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Fashion");
  fashionBtn?.click();
  await new Promise(r => setTimeout(r, 500));
  const fashionCards = [...document.querySelectorAll(".jb-pcard")];
  const fashionText = fashionCards.map(c => c.innerText).join(" | ");
  const allBtn = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "All");
  allBtn?.click();
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({
    apiCount: list.length,
    cardCount: cards.length,
    allApiNamesRendered: list.every(p => gridText.includes(p.name)),
    demoFallbackActive: gridText.includes("Smart Watch"),
    fashionCount: fashionCards.length,
    fashionOnlyFashion: fashionText.includes("T-Shirt") && fashionText.includes("Kurta") && !fashionText.includes("Serum"),
  });
})()`);
console.log("\n### 5a. catalog grid = API data");
console.log("catalog:", catalog);

// 5b: PDP navigation for a NON-first product (Grocery gift box, id 8).
await js(`location.href = "/product/8"; "nav"`);
await sleep(3500);
await report("5b. direct /product/8 (Dry Fruit Gift Box)");

// 5c: broken image URL (Storage Organiser, id 7) must fall back to the
// local default image instead of showing a broken picture.
await js(`location.href = "/product/7"; "nav"`);
await sleep(3500);
const fallbackSrc = await js(`document.querySelector('[data-testid="pdp-main-image"]')?.src || "none"`);
console.log("\n### 5c. broken-image fallback (organiser)");
console.log("main image src:", fallbackSrc);

process.exit(0);

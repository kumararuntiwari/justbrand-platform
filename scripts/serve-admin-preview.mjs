#!/usr/bin/env node
// =====================================================
// JustBrand ADMIN PREVIEW server
// =====================================================
// Serves apps/admin-panel/dist/ and — critically — injects
// window.__JB_API_BASE__ = "" into index.html so the panel calls its
// OWN origin (/api/...). Every /api/* call is proxied to an
// ISOLATED local backend (SQLite DB under /tmp), so the preview
// NEVER talks to the production Hostinger API.
//
// Port discipline: this process must be the ONLY listener the
// preview platform can map to, so the internal backend binds a
// random HIGH port (35000–44999), never the preview port.
//
// Entry point stays `sh ./scripts/serve-admin-preview.sh`
// (Freebuff's saved preview command); PORT is injected by Freebuff.
//
// Endpoints:
//   GET /__preview/health   → diagnostics (preview + local backend state)
//   /api/*                  → proxy to the isolated local backend
//   anything else           → static dist with SPA fallback
// =====================================================

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "apps", "admin-panel", "dist");
const DATA_DIR = process.env.JB_PREVIEW_DATA_DIR || "/tmp/justbrand-admin-preview-db";
const PORT = Number(process.env.PORT) || 8002;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const log = (msg) => console.log(`[admin-preview] ${msg}`);
const logErr = (msg) => console.error(`[admin-preview] ${msg}`);

// ---------- isolated local backend ----------
// cwd = DATA_DIR so the SQLite file is created THERE — the repo's
// justbrand.db and the production database are never touched.
mkdirSync(DATA_DIR, { recursive: true });

let backendChild = null;
let BACKEND = null; // http://127.0.0.1:<dynamic-port>
let backendReady = false;

async function startBackend() {
  const candidates = process.env.JB_PREVIEW_BACKEND_PORT
    ? [Number(process.env.JB_PREVIEW_BACKEND_PORT)]
    : Array.from({ length: 6 }, () => 35000 + Math.floor(Math.random() * 10000));

  for (const port of candidates) {
    if (!Number.isFinite(port) || port === PORT) continue;

    let child;
    try {
      child = spawn(process.execPath, [path.join(ROOT, "backend", "server.js")], {
        cwd: DATA_DIR,
        env: {
          ...process.env,
          PORT: String(port),
          JWT_SECRET: process.env.JWT_SECRET || "jb-admin-preview-dev-secret",
        },
        stdio: ["ignore", "inherit", "inherit"], // visible in `freebuff-preview logs`
      });
    } catch (error) {
      logErr(`spawn failed on port ${port}: ${error.message}`);
      continue;
    }

    let exited = false;
    child.on("exit", (code, signal) => {
      exited = true;
      logErr(`local backend exited (code=${code} signal=${signal})`);
    });

    // Wait up to ~5s for /api/health. A healthy answer with OUR child
    // dead means a previous preview's backend still owns the port —
    // same isolated DB, so reuse it.
    let ready = false;
    for (let t = 0; t < 34 && !ready; t++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      } catch {
        /* not up yet */
      }
      if (!ready) await new Promise((r) => setTimeout(r, 150));
    }

    if (ready) {
      if (exited) {
        log(`reusing an existing local backend on ${port} (same isolated DB)`);
        try {
          child.kill("SIGTERM");
        } catch {}
      } else {
        backendChild = child;
        log(`local backend READY on 127.0.0.1:${port} — isolated DB: ${DATA_DIR}`);
      }
      BACKEND = `http://127.0.0.1:${port}`;
      return true;
    }

    logErr(`port ${port} did not become healthy (child exited=${exited}) — trying another port`);
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  return false;
}

backendReady = await startBackend();
if (!backendReady) {
  logErr("could not start a local backend — /api will answer 503 with a clear message");
}

// Kill the child when the preview is stopped/restarted (no orphans).
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    try {
      if (backendChild) backendChild.kill("SIGTERM");
    } catch {}
    process.exit(0);
  });
}
process.on("exit", () => {
  try {
    if (backendChild) backendChild.kill("SIGTERM");
  } catch {}
});

// ---------- helpers ----------
function injectRuntimeApiBase(html) {
  // Empty string = "same origin". Runs before the module bundle.
  const snippet = `<script>window.__JB_API_BASE__ = "";</script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `  ${snippet}\n  </head>`)
    : snippet + html;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const HOP_BY_HOP = new Set([
  "host",
  "origin",
  "referer",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "accept-encoding",
  "content-length",
]);

async function proxyApi(req, res, url) {
  if (!backendReady || !BACKEND) {
    res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        success: false,
        message:
          "Preview backend unavailable: the isolated local test backend is not running. Check `freebuff-preview logs`.",
      })
    );
    return;
  }

  try {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);

    const upstream = await fetch(`${BACKEND}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch (error) {
    backendReady = false;
    logErr(`proxy error ${url.pathname}: ${error.message}`);
    res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        success: false,
        message: "Preview backend unavailable: could not reach the isolated local test backend.",
      })
    );
  }
}

async function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Bad path");
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";

  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let data;
  try {
    data = await readFile(file);
  } catch {
    // Unknown extension → real 404; otherwise SPA fallback.
    if (path.extname(rel)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    file = path.join(DIST, "index.html");
    try {
      data = await readFile(file);
    } catch {
      res
        .writeHead(500, { "content-type": "text/plain" })
        .end("Admin dist missing — run: npm run build --prefix apps/admin-panel");
      return;
    }
  }

  if (file.endsWith("index.html")) {
    data = Buffer.from(injectRuntimeApiBase(data.toString("utf8")));
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(data);
}

// ---------- server ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/__preview/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          backend: backendReady ? "local-isolated" : "unavailable",
          backendUrl: BACKEND,
          dataDir: DATA_DIR,
          apiBase: "same-origin (/api) — production Hostinger is NOT contacted",
        })
      );
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await proxyApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    logErr(`request error: ${error.message}`);
    try {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Preview server error." }));
    } catch {
      /* headers already sent */
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log(`serving Admin dist on http://0.0.0.0:${PORT} → /api → isolated backend (${BACKEND || "down"})`);
});

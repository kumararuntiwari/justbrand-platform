
// dotenv is an existing dependency; loading it makes JWT_SECRET and other
// production environment variables actually available on the server.
import "dotenv/config";

import express from "express";
import cors from "cors";
import db from "./db.js";
import businessRouter, {
  initBusiness,
} from "./business.js";
import {
  hashPassword,
  comparePassword,
  createToken,
  requireAuth,
  requireRole,
  requireType,
} from "./auth.js";

const app = express();

// CORS: wide-open by default (preserves current multi-domain setup).
// In production, set CORS_ORIGINS="https://justbrand.in,https://seller.justbrand.in"
// to restrict origins to the real JustBrand domains.
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : null;

app.use(
  cors(
    ALLOWED_ORIGINS
      ? { origin: ALLOWED_ORIGINS }
      : {}
  )
);

app.use(express.json({ limit: "10mb" }));

// =====================================
// PRODUCTION SAFETY LIMITS (additive)
// =====================================
// Soft guards against accidental runaway requests. These do not
// change any API contract — they only bound work per request.
// Tuned for the single Node process used on Hostinger.

const RUNTIME_LIMITS = {
  maxProducts: Number(process.env.JB_MAX_PRODUCTS) || 5000,
  searchTimeoutMs: Number(process.env.JB_SEARCH_TIMEOUT_MS) || 5000,
};

// Bound LIKE search payload so a huge crafted query cannot make a
// single request scan for many seconds on the event loop.
const MAX_SEARCH_LENGTH = 120;

// Express 5 routes thrown errors to the error middleware, so a
// simple setTimeout guard gives every read handler a hard ceiling.
function withTimeout(handler, ms = RUNTIME_LIMITS.searchTimeoutMs) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        const err = new Error("Request timed out.");
        err.status = 503;
        next(err);
      }
    }, ms);

    res.on("finish", () => clearTimeout(timer));

    handler(req, res, next);
  };
}

// NOTE: An earlier version added a short-TTL cache for the approved
// product list/search. It was removed on purpose: product edits and
// status changes made elsewhere in the backend must be visible to
// buyers immediately, and with proper indexes SQLite serves these
// reads in well under a millisecond, so caching added staleness
// risk for negligible gain.

// =====================================================
// PERFORMANCE INDEXES (additive — created after all tables exist)
// =====================================================
// Non-destructive: CREATE INDEX IF NOT EXISTS only ADDS lookup
// structures. No table is altered and no existing row changes.
// Called from startServer() so every table is guaranteed to
// exist first (staff/products here, business tables in initBusiness).

function ensurePerformanceIndexes() {
  db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_products_status_id
   ON products (status, id DESC)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_products_status_name
   ON products (status, name COLLATE NOCASE)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_products_seller_id
   ON products (sellerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_order_items_order
   ON order_items (orderId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_order_items_seller
   ON order_items (sellerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_orders_customer
   ON orders (customerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_orders_status
   ON orders (status)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_sellers_status
   ON sellers (status)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_seller_kyc_seller
   ON seller_kyc (sellerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_seller_bank_seller
   ON seller_bank (sellerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_mlm_members_parent
   ON mlm_members (parentId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_mlm_commissions_member
   ON mlm_commissions (memberId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_mlm_commissions_order
   ON mlm_commissions (orderId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_mlm_commissions_status
   ON mlm_commissions (status)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_payout_requests_member
   ON payout_requests (memberId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_customers_mobile
   ON customers (mobile)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_customers_status
   ON customers (status)`
).run();
db.pragma("busy_timeout = 3000");
}

// =====================================
// DATABASE
// =====================================
// Shared connection lives in db.js (WAL mode). The staff and
// products table definitions remain here so the original
// startup sequence is preserved.

db.pragma("journal_mode = WAL");

console.log("JustBrand database connected.");

// =====================================
// STAFF TABLE
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    status TEXT NOT NULL DEFAULT 'active',
    permissions TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT
  )
`).run();

console.log("Staff tables ready.");

// =====================================
// PRODUCTS TABLE
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId TEXT,
    sellerName TEXT,
    name TEXT NOT NULL,
    category TEXT,
    price TEXT,
    comparePrice TEXT,
    image TEXT,
    description TEXT,
    shortDetails TEXT,
    status TEXT DEFAULT 'Pending',
    createdAt TEXT
  )
`).run();

console.log("Product table ready.");

// =====================================
// ADDITIVE PRODUCT PRICING FIELDS
// =====================================
function ensureProductPricingColumns() {
  const columns = db.prepare("PRAGMA table_info(products)").all();
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ["hsnCode", "TEXT"],
    ["gstRate", "REAL DEFAULT 0"],
    ["deliveryCharge", "REAL DEFAULT 0"],
    ["platformCharge", "REAL DEFAULT 0"],
    ["mlmCommission", "REAL DEFAULT 0"],
    ["customerPrice", "REAL DEFAULT 0"],
    ["pricingUpdatedAt", "TEXT"],
  ];

  for (const [name, type] of additions) {
    if (!existing.has(name)) {
      db.prepare(`ALTER TABLE products ADD COLUMN ${name} ${type}`).run();
    }
  }
}

ensureProductPricingColumns();

// =====================================
// HELPER
// =====================================

function publicStaff(staff) {
  if (!staff) return null;

  return {
    id: staff.id,
    name: staff.name,
    username: staff.username,
    role: staff.role,
    status: staff.status,
    createdAt: staff.createdAt,
    lastLoginAt: staff.lastLoginAt,
    permissions:
      typeof staff.permissions === "string"
        ? JSON.parse(staff.permissions || "{}")
        : staff.permissions || {},
  };
}

// =====================================
// HEALTH CHECK
// =====================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "JustBrand Backend is running.",
  });
});

// Deep health endpoint for load balancers / uptime monitors.
// Read-only: verifies the process is up AND the database answers.
// Kept dependency-free and allocation-light so monitors can poll it
// at high frequency without affecting normal traffic.
app.get("/api/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();

    res.json({
      success: true,
      status: "ok",
      database: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(
          process.memoryUsage().rss / (1024 * 1024)
        ),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check DB failure:", error.message);

    res.status(503).json({
      success: false,
      status: "degraded",
      database: "error",
    });
  }
});

// =====================================
// STAFF LOGIN RATE LIMIT
// Additive, self-contained brute-force guard for the staff
// login endpoint. Mirrors the per-IP sliding-window limiter
// used by business.js auth routes (kept separate so the
// business module remains untouched).
// =====================================

const staffLoginAttempts = new Map();

function staffLoginLimiter(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxAttempts = 20;

  if (staffLoginAttempts.size > 5000) {
    for (const [k, stamps] of staffLoginAttempts) {
      const alive = stamps.filter((t) => now - t < windowMs);

      if (alive.length === 0) {
        staffLoginAttempts.delete(k);
      } else {
        staffLoginAttempts.set(k, alive);
      }
    }
  }

  const attempts = (staffLoginAttempts.get(key) || []).filter(
    (t) => now - t < windowMs
  );

  if (attempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: "Too many login attempts. Please try again later.",
    });
  }

  attempts.push(now);
  staffLoginAttempts.set(key, attempts);

  next();
}

// =====================================================
// STAFF LOGIN
// =====================================================

app.post("/api/staff/login", staffLoginLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required.",
      });
    }

    const staff = db.prepare(`
      SELECT *
      FROM staff
      WHERE LOWER(username) = LOWER(?)
    `).get(username);

    if (!staff) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    if (staff.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "This staff account is inactive.",
      });
    }

    const validPassword = await comparePassword(
      password,
      staff.passwordHash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    const lastLoginAt = new Date().toISOString();

    db.prepare(`
      UPDATE staff
      SET lastLoginAt = ?
      WHERE id = ?
    `).run(lastLoginAt, staff.id);

    const token = createToken({
      id: staff.id,
      staffId: staff.id,
      username: staff.username,
      role: staff.role,
    });

    const updatedStaff = db.prepare(`
      SELECT *
      FROM staff
      WHERE id = ?
    `).get(staff.id);

    res.json({
      success: true,
      message: "Login successful.",
      token,
      staff: publicStaff(updatedStaff),
    });
  } catch (error) {
    console.error("STAFF LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Staff login failed.",
    });
  }
});

// =====================================================
// CURRENT STAFF
// =====================================================

app.get(
  "/api/staff/me",
  requireAuth,
  async (req, res) => {
    try {
      const staff = db.prepare(`
        SELECT *
        FROM staff
        WHERE id = ?
      `).get(req.user.staffId || req.user.id);

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff account not found.",
        });
      }

      if (staff.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Staff account is inactive.",
        });
      }

      res.json({
        success: true,
        staff: publicStaff(staff),
      });
    } catch (error) {
      console.error("STAFF ME ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Failed to load staff account.",
      });
    }
  }
);

// =====================================================
// GET ALL STAFF
// SUPER ADMIN ONLY
// =====================================================

app.get(
  "/api/admin/staff",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const staff = db.prepare(`
        SELECT
          id,
          name,
          username,
          role,
          status,
          permissions,
          createdAt,
          lastLoginAt
        FROM staff
        ORDER BY id DESC
      `).all();

      res.json({
        success: true,
        staff: staff.map(publicStaff),
      });
    } catch (error) {
      console.error("GET STAFF ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Failed to load staff.",
      });
    }
  }
);

// =====================================================
// CREATE STAFF
// SUPER ADMIN ONLY
// =====================================================

app.post(
  "/api/admin/staff",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const {
        name = "",
        username = "",
        password = "",
        role = "staff",
        status = "active",
        permissions = {},
      } = req.body;

      const cleanName = String(name).trim();
      const cleanUsername = String(username).trim();

      const allowedRoles = [
        "manager",
        "accountant",
        "staff",
      ];

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          message: "Staff name is required.",
        });
      }

      if (!cleanUsername) {
        return res.status(400).json({
          success: false,
          message: "Username is required.",
        });
      }

      if (!password || String(password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters.",
        });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid staff role.",
        });
      }

      const existing = db.prepare(`
        SELECT id
        FROM staff
        WHERE LOWER(username) = LOWER(?)
      `).get(cleanUsername);

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Username already exists.",
        });
      }

      const passwordHash =
        await hashPassword(String(password));

      const defaultPermissions = {
        productApproval: role === "manager",
        finance: role === "accountant",
        customerQueries: true,
        staffManagement: false,
        payments: false,
      };

      const finalPermissions = {
        ...defaultPermissions,
        ...(permissions || {}),
      };

      const result = db.prepare(`
        INSERT INTO staff (
          name,
          username,
          passwordHash,
          role,
          status,
          permissions,
          createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanName,
        cleanUsername,
        passwordHash,
        role,
        status === "inactive"
          ? "inactive"
          : "active",
        JSON.stringify(finalPermissions),
        new Date().toISOString()
      );

      const newStaff = db.prepare(`
        SELECT *
        FROM staff
        WHERE id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: "Staff account created successfully.",
        staff: publicStaff(newStaff),
      });
    } catch (error) {
      console.error("CREATE STAFF ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create staff account.",
      });
    }
  }
);

// =====================================================
// UPDATE STAFF
// SUPER ADMIN ONLY
// =====================================================

app.put(
  "/api/admin/staff/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid staff ID.",
        });
      }

      const staff = db.prepare(`
        SELECT *
        FROM staff
        WHERE id = ?
      `).get(id);

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff account not found.",
        });
      }

      if (
        staff.role === "super_admin" &&
        req.body.role &&
        req.body.role !== "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "Super Admin role cannot be changed.",
        });
      }

      const name =
        req.body.name !== undefined
          ? String(req.body.name).trim()
          : staff.name;

      const role =
        req.body.role !== undefined
          ? String(req.body.role)
          : staff.role;

      const status =
        req.body.status === "inactive"
          ? "inactive"
          : "active";

      const allowedRoles = [
        "super_admin",
        "manager",
        "accountant",
        "staff",
      ];

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role.",
        });
      }

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Staff name is required.",
        });
      }

      let permissions =
        req.body.permissions !== undefined
          ? req.body.permissions
          : JSON.parse(staff.permissions || "{}");

      if (role === "super_admin") {
        permissions = {
          all: true,
          staffManagement: true,
          productApproval: true,
          finance: true,
          payments: true,
        };
      }

      db.prepare(`
        UPDATE staff
        SET
          name = ?,
          role = ?,
          status = ?,
          permissions = ?
        WHERE id = ?
      `).run(
        name,
        role,
        status,
        JSON.stringify(permissions),
        id
      );

      const updatedStaff = db.prepare(`
        SELECT *
        FROM staff
        WHERE id = ?
      `).get(id);

      res.json({
        success: true,
        message: "Staff account updated successfully.",
        staff: publicStaff(updatedStaff),
      });
    } catch (error) {
      console.error("UPDATE STAFF ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update staff account.",
      });
    }
  }
);

// =====================================================
// CHANGE STAFF PASSWORD
// SUPER ADMIN ONLY
// =====================================================

app.put(
  "/api/admin/staff/:id/password",
  requireAuth,
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const password = String(req.body.password || "");

      if (!password || password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters.",
        });
      }

      const staff = db.prepare(`
        SELECT id
        FROM staff
        WHERE id = ?
      `).get(id);

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff account not found.",
        });
      }

      const passwordHash =
        await hashPassword(password);

      db.prepare(`
        UPDATE staff
        SET passwordHash = ?
        WHERE id = ?
      `).run(passwordHash, id);

      res.json({
        success: true,
        message: "Staff password changed successfully.",
      });
    } catch (error) {
      console.error(
        "CHANGE PASSWORD ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to change password.",
      });
    }
  }
);

// =====================================================
// DELETE STAFF
// SUPER ADMIN ONLY
// =====================================================

app.delete(
  "/api/admin/staff/:id",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      if (id === Number(req.user.staffId || req.user.id)) {
        return res.status(400).json({
          success: false,
          message:
            "You cannot delete your own Super Admin account.",
        });
      }

      const staff = db.prepare(`
        SELECT *
        FROM staff
        WHERE id = ?
      `).get(id);

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff account not found.",
        });
      }

      if (staff.role === "super_admin") {
        return res.status(403).json({
          success: false,
          message:
            "Super Admin account cannot be deleted.",
        });
      }

      db.prepare(`
        DELETE FROM staff
        WHERE id = ?
      `).run(id);

      res.json({
        success: true,
        message: "Staff account deleted successfully.",
      });
    } catch (error) {
      console.error(
        "DELETE STAFF ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to delete staff account.",
      });
    }
  }
);

// =====================================================
// GET APPROVED PRODUCTS
// BUYER APP
// =====================================================

app.get("/api/products", withTimeout((req, res) => {
  try {
    const products = db.prepare(`
      SELECT *
      FROM products
      WHERE status = 'Approved'
      ORDER BY id DESC
      LIMIT ?
    `).all(RUNTIME_LIMITS.maxProducts);

    res.json(products);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to load products.",
    });
  }
}));

// =====================================================
// GET ALL PRODUCTS
// ADMIN
// =====================================================

app.get(
  "/api/admin/products",
  requireAuth,
  requireRole(
    "super_admin",
    "manager"
  ),
  (req, res) => {
    try {
      const products = db.prepare(`
        SELECT *
        FROM products
        ORDER BY id DESC
      `).all();

      res.json({
        success: true,
        products,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Failed to load products.",
      });
    }
  }
);

// =====================================================
// ADD PRODUCT
// SELLER APP
// =====================================================

// =====================================================
// ADD PRODUCT (LEGACY ENDPOINT — NOW AUTHENTICATED)
// =====================================================
// Previously anonymous; kept for backward compatibility with the
// legacy seller bundle. Now requires a seller or staff token so
// anonymous users cannot inject pending products. For seller tokens
// the product identity comes from the token itself (body values are
// ignored), so one seller cannot create products under another
// seller's name. The current seller app uses POST
// /api/sellers/products, which has the same behavior.

app.post("/api/products", requireAuth, (req, res) => {

  const isSeller = req.user.type === "seller";
  const isStaff = Boolean(req.user.role);

  if (!isSeller && !isStaff) {
    return res.status(403).json({
      success: false,
      message: "Only seller or staff accounts can submit products."
    });
  }

  const sellerId = isSeller
    ? req.user.sellerCode
    : String(req.body.sellerId || "").trim();

  const sellerName = isSeller
    ? req.user.name
    : String(req.body.sellerName || "").trim();

  try {
    const {
      name = "",
      category = "",
      price = "",
      comparePrice = "",
      image = "",
      description = "",
      shortDetails = "",
      createdAt,
    } = req.body;

    if (!String(name).trim()) {
      return res.status(400).json({
        success: false,
        message:
          "Product name is required.",
      });
    }

    const result = db.prepare(`
      INSERT INTO products (
        sellerId,
        sellerName,
        name,
        category,
        price,
        comparePrice,
        image,
        description,
        shortDetails,
        status,
        createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
    `).run(
      sellerId,
      sellerName,
      name,
      category,
      price,
      comparePrice,
      image,
      description,
      shortDetails,
      createdAt ||
        new Date().toISOString()
    );

    const product = db.prepare(`
      SELECT *
      FROM products
      WHERE id = ?
    `).get(result.lastInsertRowid);

    console.log(
      "NEW SELLER PRODUCT:",
      product
    );

    res.json({
      success: true,
      message:
        "Product submitted for admin approval.",
      product,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to add product.",
    });
  }
});

// =====================================================
// APPROVE PRODUCT
// SUPER ADMIN / MANAGER
// =====================================================

app.put(
  "/api/admin/products/:id/approve",
  requireAuth,
  requireRole(
    "super_admin",
    "manager"
  ),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = db.prepare(`
        UPDATE products
        SET status = 'Approved'
        WHERE id = ?
      `).run(id);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Product not found.",
        });
      }

      const product = db.prepare(`
        SELECT *
        FROM products
        WHERE id = ?
      `).get(id);

      res.json({
        success: true,
        message:
          "Product approved successfully.",
        product,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Failed to approve product.",
      });
    }
  }
);

// =====================================================
// REJECT PRODUCT
// SUPER ADMIN / MANAGER
// =====================================================

app.put(
  "/api/admin/products/:id/reject",
  requireAuth,
  requireRole(
    "super_admin",
    "manager"
  ),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = db.prepare(`
        UPDATE products
        SET status = 'Rejected'
        WHERE id = ?
      `).run(id);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Product not found.",
        });
      }

      const product = db.prepare(`
        SELECT *
        FROM products
        WHERE id = ?
      `).get(id);

      res.json({
        success: true,
        message:
          "Product rejected.",
        product,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Failed to reject product.",
      });
    }
  }
);

// =====================================================
// DELETE PRODUCT
// SUPER ADMIN ONLY
// =====================================================

app.delete(
  "/api/products/:id",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const result = db.prepare(`
        DELETE FROM products
        WHERE id = ?
      `).run(id);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Product not found.",
        });
      }

      res.json({
        success: true,
        message:
          "Product deleted.",
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Failed to delete product.",
      });
    }
  }
);

// =====================================================
// SEARCH APPROVED PRODUCTS
// =====================================================

app.get(
  "/api/products/search",
  withTimeout((req, res) => {
    try {
      const search = String(
        req.query.q || ""
      )
        .toLowerCase()
        .slice(0, MAX_SEARCH_LENGTH);

      const products = db.prepare(`
        SELECT *
        FROM products
        WHERE status = 'Approved'
        AND (
          LOWER(name) LIKE ?
          OR LOWER(category) LIKE ?
          OR LOWER(description) LIKE ?
          OR LOWER(shortDetails) LIKE ?
        )
        ORDER BY id DESC
      `).all(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );

      res.json({
        success: true,
        products,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Search failed.",
      });
    }
  })
);

// =====================================================
// COMPARE PRICE
// =====================================================

app.get(
  "/api/compare",
  (req, res) => {
    try {
      const search = String(
        req.query.q || ""
      ).trim();

      if (!search) {
        return res.json({
          success: false,
          message:
            "Please enter product name.",
          results: [],
        });
      }

      const product = db.prepare(`
        SELECT *
        FROM products
        WHERE status = 'Approved'
        AND LOWER(name) LIKE ?
        ORDER BY id DESC
        LIMIT 1
      `).get(
        `%${search.toLowerCase()}%`
      );

      const productName =
        product?.name || search;

      const justBrandPrice =
        product?.price || "999";

      const compareResults = [
        {
          platform: "JustBrand",
          productName,
          image:
            product?.image ||
            "/images/product1.png",
          price: justBrandPrice,
          rating: "4.5",
          delivery:
            "Fast Delivery",
          link: "#",
          isBestPrice: false,
        },
        {
          platform: "Amazon",
          productName,
          image:
            product?.image ||
            "/images/product1.png",
          price: "949",
          rating: "4.4",
          delivery:
            "Prime Delivery",
          link: "#",
          isBestPrice: false,
        },
        {
          platform: "Flipkart",
          productName,
          image:
            product?.image ||
            "/images/product1.png",
          price: "929",
          rating: "4.3",
          delivery:
            "Free Delivery",
          link: "#",
          isBestPrice: false,
        },
        {
          platform: "Meesho",
          productName,
          image:
            product?.image ||
            "/images/product1.png",
          price: "899",
          rating: "4.2",
          delivery:
            "Standard Delivery",
          link: "#",
          isBestPrice: false,
        },
      ];

      const prices =
        compareResults.map(
          (item) =>
            Number(
              String(item.price)
                .replace("₹", "")
                .replace("Γé╣", "")
                .replace(",", "")
                .trim()
            )
        );

      const lowestPrice =
        Math.min(...prices);

      compareResults.forEach(
        (item) => {
          const price =
            Number(
              String(item.price)
                .replace("₹", "")
                .replace("Γé╣", "")
                .replace(",", "")
                .trim()
            );

          if (
            price === lowestPrice
          ) {
            item.isBestPrice = true;
          }
        }
      );

      res.json({
        success: true,
        search,
        product:
          product || null,
        results:
          compareResults,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Compare failed.",
      });
    }
  }
);

// =====================================================
// BUSINESS ROUTER (sellers, customers, orders, MLM)
// =====================================================
// All new business functionality is additive and mounted here.
// initBusiness() performs the additive table initialization.

initBusiness();

app.use(businessRouter);

async function startServer() {
  // Safe now: staff/products tables were created at module level
  // and initBusiness() has created all business tables.
  ensurePerformanceIndexes();
  // =====================================
  // CREATE DEFAULT SUPER ADMIN
  // =====================================

  const existingSuperAdmin = db.prepare(`
    SELECT id
    FROM staff
    WHERE username = ?
  `).get("superadmin");

  if (!existingSuperAdmin) {
    const passwordHash =
      await hashPassword(
        "JustBrand@2026"
      );

    db.prepare(`
      INSERT INTO staff (
        name,
        username,
        passwordHash,
        role,
        status,
        permissions,
        createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "JustBrand Super Admin",
      "superadmin",
      passwordHash,
      "super_admin",
      "active",
      JSON.stringify({
        all: true,
        staffManagement: true,
        productApproval: true,
        finance: true,
        payments: true,
      }),
      new Date().toISOString()
    );

    console.log(
      "Default Super Admin created."
    );
  }

  // =====================================
  // HOSTINGER PORT
  // =====================================

  const PORT =
    Number(process.env.PORT) || 5000;

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        "====================================="
      );
      console.log(
        "JustBrand Backend running"
      );
      console.log(
        `Port: ${PORT}`
      );
      console.log(
        "====================================="
      );
    }
  );
}

// =====================================
// START APPLICATION
// =====================================

startServer().catch((error) => {
  console.error(
    "SERVER START ERROR:",
    error
  );

  process.exit(1);
});


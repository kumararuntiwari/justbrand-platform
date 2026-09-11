
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import {
  hashPassword,
  comparePassword,
  createToken,
  requireAuth,
  requireRole,
} from "./auth.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// =====================================
// DATABASE
// =====================================

const db = new Database("justbrand.db");

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

// =====================================================
// STAFF LOGIN
// =====================================================

app.post("/api/staff/login", async (req, res) => {
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

app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare(`
      SELECT *
      FROM products
      WHERE status = 'Approved'
      ORDER BY id DESC
    `).all();

    res.json(products);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to load products.",
    });
  }
});

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

app.post("/api/products", (req, res) => {
  try {
    const {
      sellerId = "",
      sellerName = "",
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
  (req, res) => {
    try {
      const search = String(
        req.query.q || ""
      ).toLowerCase();

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
  }
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

      if (!product) {
        return res.json({
          success: true,
          search,
          product: null,
          results: [],
        });
      }

      const compareResults = [
        {
          platform: "JustBrand",
          productName: product.name,
          image: product.image || null,
          price: product.price,
          rating: null,
          delivery: null,
          link: null,
          isBestPrice: true,
        },
      ];

      res.json({
        success: true,
        search,
        product,
        results: compareResults,
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
// SERVER START
// =====================================================

async function startServer() {
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


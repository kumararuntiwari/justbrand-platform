// =====================================================
// JUSTBRAND BUSINESS LAYER
// =====================================================
// Additive module mounted by server.js. Contains:
//   - Sellers (registration, login, KYC, bank, products, orders)
//   - Customers (registration, login, orders)
//   - Orders (stored in DB, status tracking, cancellation)
//   - JustBrand Family / MLM (members, A/B/C placement, spillover,
//     tree, wallet, commissions, admin-configurable rules)
//   - Commission engine (return window, cancelled/refunded rules)
//   - Admin management endpoints (role-restricted)
//
// Rules preserved from the existing MLM commission configuration:
//   directCommission: 10, levelCommission: 5, binaryCommission: 5,
//   shoppingCommission: 3, returnPeriodDays: 7, directMemberLimit: 3,
//   commissionAfterReturn: true, cancelCommission: false,
//   returnCommission: false
// =====================================================

import express from "express";
import {
  hashPassword,
  comparePassword,
  createToken,
  requireAuth,
  requireRole,
  requireType,
} from "./auth.js";
import db from "./db.js";

export const businessRouter = express.Router();

// =====================================
// HELPERS
// =====================================

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

function publicSeller(seller) {
  if (!seller) return null;
  return {
    id: seller.id,
    sellerCode: seller.sellerCode,
    name: seller.name,
    shopName: seller.shopName,
    mobile: seller.mobile,
    email: seller.email,
    status: seller.status,
    createdAt: seller.createdAt,
    lastLoginAt: seller.lastLoginAt,
  };
}

function publicCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    email: customer.email,
    referredByMemberId: customer.referredByMemberId,
    createdAt: customer.createdAt,
  };
}

function publicMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    memberId: member.memberId,
    name: member.name,
    mobile: member.mobile,
    email: member.email,
    referralCode: member.referralCode,
    parentId: member.parentId,
    parentName: member.parentName || null,
    position: member.position,
    status: member.status,
    createdAt: member.createdAt,
  };
}

// Simple in-memory rate limiter for auth endpoints
// (no new dependencies; sliding window per IP per route).
const authAttempts = new Map();

function pruneAuthAttempts(nowMs) {
  if (authAttempts.size <= 5000) return;

  for (const [key, timestamps] of authAttempts) {
    const alive = timestamps.filter(
      (timestamp) => nowMs - timestamp < 5 * 60 * 1000
    );

    if (alive.length === 0) {
      authAttempts.delete(key);
    } else {
      authAttempts.set(key, alive);
    }
  }
}

function rateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip || "unknown"}:${req.baseUrl || ""}${req.route?.path || req.path}`;
    const currentTime = Date.now();

    pruneAuthAttempts(currentTime);

    const attempts = (authAttempts.get(key) || []).filter(
      (timestamp) => currentTime - timestamp < windowMs
    );

    if (attempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
      });
    }

    attempts.push(currentTime);
    authAttempts.set(key, attempts);

    next();
  };
}

// =====================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerCode TEXT UNIQUE,
    name TEXT NOT NULL,
    shopName TEXT,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_kyc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER UNIQUE NOT NULL,
    shopName TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    gstNumber TEXT,
    panNumber TEXT,
    aadhaarNumber TEXT,
    kycStatus TEXT NOT NULL DEFAULT 'Pending',
    rejectionReason TEXT,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER UNIQUE NOT NULL,
    accountName TEXT,
    accountNumber TEXT,
    ifscCode TEXT,
    bankName TEXT,
    upiId TEXT,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT,
    passwordHash TEXT NOT NULL,
    referredByMemberId TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderNumber TEXT UNIQUE NOT NULL,
    customerId INTEGER NOT NULL,
    customerName TEXT,
    phone TEXT,
    address TEXT,
    totalAmount TEXT,
    paymentMethod TEXT DEFAULT 'COD',
    paymentStatus TEXT DEFAULT 'Pending',
    paymentRef TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    deliveredAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    productName TEXT,
    sellerId TEXT,
    price TEXT,
    quantity INTEGER NOT NULL DEFAULT 1
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT,
    passwordHash TEXT NOT NULL,
    referralCode TEXT UNIQUE,
    parentId TEXT,
    position TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_wallets (
    memberId TEXT PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    totalEarned REAL NOT NULL DEFAULT 0,
    totalPaid REAL NOT NULL DEFAULT 0,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT NOT NULL,
    orderId INTEGER,
    type TEXT,
    description TEXT,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending',
    createdAt TEXT NOT NULL,
    payableAt TEXT,
    paidAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT
  )
`).run();

// =====================================
// SELLER PRICING / TAX SETTINGS
// =====================================
db.prepare(`
  CREATE TABLE IF NOT EXISTS pricing_settings (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL,
    updatedAt TEXT
  )
`).run();

const DEFAULT_PRICING_RULES = {
  deliveryFlat: 40,
  platformPercent: 5,
  mlmPercent: 3,
};

function getPricingRules() {
  const rows = db.prepare(`SELECT key, value FROM pricing_settings`).all();
  const rules = { ...DEFAULT_PRICING_RULES };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(rules, row.key)) rules[row.key] = Number(row.value);
  }
  return rules;
}

function calculateCustomerPricing(basePrice, gstRate = 0) {
  const base = Math.max(0, Number(basePrice) || 0);
  const rules = getPricingRules();
  const platformCharge = base * rules.platformPercent / 100;
  const mlmCommission = base * rules.mlmPercent / 100;
  const deliveryCharge = rules.deliveryFlat;
  const taxableAmount = base + platformCharge + mlmCommission + deliveryCharge;
  const gstAmount = taxableAmount * (Math.max(0, Number(gstRate) || 0) / 100);
  const customerPrice = Math.ceil((taxableAmount + gstAmount) * 100) / 100;
  return {
    basePrice: Math.round(base * 100) / 100,
    gstRate: Math.max(0, Number(gstRate) || 0),
    gstAmount: Math.round(gstAmount * 100) / 100,
    deliveryCharge: Math.round(deliveryCharge * 100) / 100,
    platformCharge: Math.round(platformCharge * 100) / 100,
    mlmCommission: Math.round(mlmCommission * 100) / 100,
    customerPrice,
  };
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT,
    status TEXT NOT NULL DEFAULT 'Processing',
    createdAt TEXT NOT NULL,
    processedAt TEXT
  )
`).run();

// =====================================
// MLM SETTINGS (ADMIN CONFIGURABLE)
// =====================================

const DEFAULT_MLM_RULES = {
  directCommission: 10,
  levelCommission: 5,
  binaryCommission: 5,
  shoppingCommission: 3,
  returnPeriodDays: 7,
  directMemberLimit: 3,
  commissionAfterReturn: true,
  cancelCommission: false,
  returnCommission: false,
};

function getMlmRules() {
  const row = db
    .prepare(`SELECT value FROM mlm_settings WHERE key = 'commission_rules'`)
    .get();

  if (!row) return { ...DEFAULT_MLM_RULES };

  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_MLM_RULES, ...parsed };
  } catch {
    return { ...DEFAULT_MLM_RULES };
  }
}

function saveMlmRules(rules) {
  db.prepare(`
    INSERT INTO mlm_settings (key, value, updatedAt)
    VALUES ('commission_rules', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(JSON.stringify(rules), now());
}

// =====================================
// MLM PLACEMENT (A/B/C + SPILLOVER)
// =====================================
// A member can have maximum 3 direct placements (A, B, C).
// When a referrer's 3 direct slots are full, the new member is
// spilled over to the first member in their subtree (breadth-first)
// that still has a free slot.

const MAX_DIRECT = 3;

function countDirectChildren(parentId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM mlm_members WHERE parentId = ?`)
    .get(parentId);
  return row ? row.count : 0;
}

function findPlacementFor(referrer) {
  // Breadth-first search starting from the referrer.
  const queue = [referrer.memberId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    const children = db
      .prepare(
        `SELECT memberId FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
      )
      .all(currentId);

    if (children.length < MAX_DIRECT) {
      const position = ["A", "B", "C"][children.length] || "C";

      return { parentId: currentId, position };
    }

    children.forEach((child) => queue.push(child.memberId));
  }

  // Fallback (practically unreachable): place under the referrer as C.
  return { parentId: referrer.memberId, position: "C" };
}

function generateMemberId() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `JB${Math.floor(100000 + Math.random() * 900000)}`;

    const existing = db
      .prepare(`SELECT id FROM mlm_members WHERE memberId = ?`)
      .get(candidate);

    if (!existing) return candidate;
  }

  // Extremely unlikely fallback: timestamp-based ID.
  return `JB${Date.now()}`.slice(0, 8);
}

// =====================================
// MLM COMMISSION ENGINE
// =====================================
// Commission lifecycle (preserves existing business rules):
//   1. Order placed            -> no commission
//   2. Order Delivered         -> commission records created as Pending
//   3. Return window passes    -> Pending becomes Payable (wallet credited)
//   4. Cancelled / Returned    -> no commission (Pending records are voided)
// Payment of Payable commissions to bank/UPI stays a restricted
// Super Admin / Accountant action (mlm_commissions.status -> 'Paid').

function releaseDueCommissions() {
  const due = db
    .prepare(`
      SELECT id, memberId, amount
      FROM mlm_commissions
      WHERE status = 'Pending'
      AND payableAt IS NOT NULL
      AND payableAt <= ?
    `)
    .all(now());

  due.forEach((commission) => {
    const markPayable = db.transaction(() => {
      db.prepare(
        `UPDATE mlm_commissions SET status = 'Payable' WHERE id = ?`
      ).run(commission.id);

      db.prepare(`
        INSERT INTO mlm_wallets (memberId, balance, totalEarned, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(memberId) DO UPDATE SET
          balance = balance + excluded.balance,
          totalEarned = totalEarned + excluded.totalEarned,
          updatedAt = excluded.updatedAt
      `).run(commission.memberId, commission.amount, commission.amount, now());
    });

    markPayable();
  });
}

function voidCommissionsForOrder(orderId) {
  db.prepare(`
    UPDATE mlm_commissions
    SET status = 'Void'
    WHERE orderId = ? AND status = 'Pending'
  `).run(orderId);
}

function generateCommissionsForOrder(order) {
  const rules = getMlmRules();

  // Cancelled / returned orders never generate commission.
  if (["Cancelled", "Returned", "Refunded"].includes(order.status)) {
    return;
  }

  // Already generated? Do not duplicate.
  const existing = db
    .prepare(`SELECT id FROM mlm_commissions WHERE orderId = ? LIMIT 1`)
    .get(order.id);

  if (existing) return;

  // Find the MLM member linked to the buyer, if any.
  const buyerAsMember = db
    .prepare(
      `SELECT * FROM mlm_members WHERE mobile = ? AND status = 'active' LIMIT 1`
    )
    .get(clean(order.phone));

  const orderTotal =
    Number(String(order.totalAmount || "0").replace(/[^0-9.]/g, "")) || 0;

  if (orderTotal <= 0) return;

  const payableAt = rules.commissionAfterReturn
    ? new Date(
        new Date(order.deliveredAt || order.createdAt).getTime() +
          (Number(rules.returnPeriodDays) || 0) * 24 * 60 * 60 * 1000
      ).toISOString()
    : now();

  const records = [];

  if (buyerAsMember) {
    // Shopping commission for the member who purchased.
    if (rules.shoppingCommission > 0) {
      records.push({
        memberId: buyerAsMember.memberId,
        type: "shopping",
        description: `Shopping commission (${rules.shoppingCommission}%) on order ${order.orderNumber}`,
        amount: (orderTotal * rules.shoppingCommission) / 100,
      });
    }

    // Upline commissions: direct referrer (level 1) and above.
    let current = buyerAsMember.parentId
      ? db
          .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
          .get(buyerAsMember.parentId)
      : null;

    let level = 1;

    while (current && level <= 3) {
      const percentage =
        level === 1 ? rules.directCommission : rules.levelCommission;

      if (percentage > 0) {
        records.push({
          memberId: current.memberId,
          type: level === 1 ? "direct" : "level",
          description: `Level ${level} commission (${percentage}%) on order ${order.orderNumber}`,
          amount: (orderTotal * percentage) / 100,
        });
      }

      current = current.parentId
        ? db
            .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
            .get(current.parentId)
        : null;

      level += 1;
    }
  }

  if (records.length === 0) return;

  const insertAll = db.transaction(() => {
    records.forEach((record) => {
      db.prepare(`
        INSERT INTO mlm_commissions (
          memberId, orderId, type, description, amount, status, createdAt, payableAt
        )
        VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
      `).run(
        record.memberId,
        order.id,
        record.type,
        record.description,
        record.amount,
        now(),
        payableAt
      );
    });
  });

  insertAll();
}

function orderWithItems(order) {
  const items = db
    .prepare(`SELECT * FROM order_items WHERE orderId = ?`)
    .all(order.id);

  return { ...order, items };
}

// =====================================================
// PAYMENT CONFIG (NON-SECRET DISPLAY DATA ONLY)
// =====================================================
// Secret merchant credentials never leave the backend. Only the
// display identifiers needed by the UPI / bank-transfer checkout
// flow are returned. Configure via backend environment variables:
//   PAYMENT_MODE, PAYMENT_UPI_ID, PAYMENT_BANK_NAME,
//   PAYMENT_BANK_ACCOUNT_NAME, PAYMENT_BANK_ACCOUNT_NUMBER,
//   PAYMENT_BANK_IFSC

businessRouter.get("/api/payment/config", (req, res) => {
  const mode = (process.env.PAYMENT_MODE || "COD")
    .trim();

  const methods = ["COD"];

  if (mode.includes("UPI") || mode === "ALL") methods.push("UPI", "BankTransfer");
  if (mode.includes("Bank")) methods.push("BankTransfer");

  res.json({
    success: true,
    paymentMethods: methods,
    upiId: process.env.PAYMENT_UPI_ID || "",
    bank: {
      bankName: process.env.PAYMENT_BANK_NAME || "",
      accountName: process.env.PAYMENT_BANK_ACCOUNT_NAME || "",
      // Only last 4 digits are exposed publicly.
      accountLast4: (process.env.PAYMENT_BANK_ACCOUNT_NUMBER || "").slice(-4),
      ifsc: process.env.PAYMENT_BANK_IFSC || "",
    },
    note:
      "UPI / bank-transfer orders remain Pending until payment is verified by the JustBrand accounts team.",
  });
});

// =====================================================
// SELLER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/sellers/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name || req.body.sellerName);
      const shopName = clean(req.body.shopName);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");

      if (!name) {
        return res.status(400).json({ success: false, message: "Seller name is required." });
      }

      if (!shopName) {
        return res.status(400).json({ success: false, message: "Shop / business name is required." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (!email || !email.includes("@")) {
        return res.status(400).json({ success: false, message: "A valid email address is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existingMobile = db
        .prepare(`SELECT id FROM sellers WHERE mobile = ?`)
        .get(mobile);

      if (existingMobile) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      const existingEmail = db
        .prepare(`SELECT id FROM sellers WHERE LOWER(email) = ?`)
        .get(email);

      if (existingEmail) {
        return res.status(409).json({ success: false, message: "This email is already registered." });
      }

      const passwordHash = await hashPassword(password);

      const sellerCode = `SELLER-${Date.now()}`;

      const result = db.prepare(`
        INSERT INTO sellers (sellerCode, name, shopName, mobile, email, passwordHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sellerCode, name, shopName, mobile, email, passwordHash, now());

      // Seed KYC record with registration data (Pending by default).
      db.prepare(`
        INSERT INTO seller_kyc (sellerId, shopName, kycStatus, updatedAt)
        VALUES (?, ?, 'Pending', ?)
      `).run(result.lastInsertRowid, shopName, now());

      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(result.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: "Seller account created. Please login.",
        seller: publicSeller(seller),
      });
    } catch (error) {
      console.error("SELLER REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Seller registration failed." });
    }
  }
);

// =====================================================
// SELLER LOGIN
// =====================================================

businessRouter.post(
  "/api/sellers/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const loginId = clean(req.body.loginId || req.body.mobile || req.body.email);
      const password = String(req.body.password || "");

      if (!loginId || !password) {
        return res.status(400).json({ success: false, message: "Mobile/email and password are required." });
      }

      const seller = db
        .prepare(
          `SELECT * FROM sellers WHERE mobile = ? OR LOWER(email) = LOWER(?)`
        )
        .get(loginId, loginId);

      if (!seller || !(await comparePassword(password, seller.passwordHash))) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      if (seller.status !== "active") {
        return res.status(403).json({ success: false, message: "This seller account is suspended." });
      }

      db.prepare(`UPDATE sellers SET lastLoginAt = ? WHERE id = ?`).run(
        now(),
        seller.id
      );

      const token = createToken({
        type: "seller",
        sellerId: seller.id,
        sellerCode: seller.sellerCode,
        name: seller.name,
      });

      res.json({
        success: true,
        message: "Login successful.",
        token,
        seller: publicSeller(seller),
      });
    } catch (error) {
      console.error("SELLER LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Seller login failed." });
    }
  }
);

// =====================================================
// SELLER PROFILE
// =====================================================

businessRouter.get(
  "/api/sellers/me",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const kyc = db
      .prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`)
      .get(seller.id);

    res.json({
      success: true,
      seller: { ...publicSeller(seller), kycStatus: kyc?.kycStatus || "Pending" },
    });
  }
);

// =====================================================
// SELLER KYC
// =====================================================

businessRouter.get(
  "/api/sellers/kyc",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const kyc = db
      .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
      .get(req.user.sellerId);

    res.json({ success: true, kyc: kyc || { kycStatus: "Pending" } });
  }
);

businessRouter.put(
  "/api/sellers/kyc",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const existing = db
        .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
        .get(req.user.sellerId);

      const fields = {
        shopName: clean(req.body.shopName),
        address: clean(req.body.address),
        city: clean(req.body.city),
        state: clean(req.body.state),
        pincode: clean(req.body.pincode),
        gstNumber: clean(req.body.gstNumber),
        panNumber: clean(req.body.panNumber),
        aadhaarNumber: clean(req.body.aadhaarNumber),
      };

      // Sellers can update their KYC details, but the approval status
      // is controlled by the admin only.
      const kycStatus = existing
        ? existing.kycStatus === "Approved"
          ? "Pending"
          : existing.kycStatus
        : "Pending";

      if (existing) {
        db.prepare(`
          UPDATE seller_kyc
          SET shopName = ?, address = ?, city = ?, state = ?, pincode = ?,
              gstNumber = ?, panNumber = ?, aadhaarNumber = ?, kycStatus = ?, updatedAt = ?
          WHERE sellerId = ?
        `).run(
          fields.shopName || existing.shopName,
          fields.address || existing.address,
          fields.city || existing.city,
          fields.state || existing.state,
          fields.pincode || existing.pincode,
          fields.gstNumber || existing.gstNumber,
          fields.panNumber || existing.panNumber,
          fields.aadhaarNumber || existing.aadhaarNumber,
          kycStatus,
          now(),
          req.user.sellerId
        );
      } else {
        db.prepare(`
          INSERT INTO seller_kyc (
            sellerId, shopName, address, city, state, pincode,
            gstNumber, panNumber, aadhaarNumber, kycStatus, updatedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
        `).run(
          req.user.sellerId,
          fields.shopName,
          fields.address,
          fields.city,
          fields.state,
          fields.pincode,
          fields.gstNumber,
          fields.panNumber,
          fields.aadhaarNumber,
          now()
        );
      }

      const kyc = db
        .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
        .get(req.user.sellerId);

      res.json({
        success: true,
        message: "KYC details saved. Approval pending with admin.",
        kyc,
      });
    } catch (error) {
      console.error("SELLER KYC ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save KYC details." });
    }
  }
);

// =====================================================
// SELLER BANK DETAILS
// =====================================================

businessRouter.get(
  "/api/sellers/bank",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const bank = db
      .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
      .get(req.user.sellerId);

    res.json({ success: true, bank: bank || null });
  }
);

businessRouter.put(
  "/api/sellers/bank",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const existing = db
        .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
        .get(req.user.sellerId);

      const accountNumber = clean(req.body.accountNumber);

      if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) {
        return res.status(400).json({ success: false, message: "Account number must be 6-20 digits." });
      }

      const fields = {
        accountName: clean(req.body.accountName),
        accountNumber,
        ifscCode: clean(req.body.ifscCode).toUpperCase(),
        bankName: clean(req.body.bankName),
        upiId: clean(req.body.upiId),
      };

      if (existing) {
        db.prepare(`
          UPDATE seller_bank
          SET accountName = ?, accountNumber = ?, ifscCode = ?, bankName = ?, upiId = ?, updatedAt = ?
          WHERE sellerId = ?
        `).run(
          fields.accountName || existing.accountName,
          fields.accountNumber || existing.accountNumber,
          fields.ifscCode || existing.ifscCode,
          fields.bankName || existing.bankName,
          fields.upiId || existing.upiId,
          now(),
          req.user.sellerId
        );
      } else {
        db.prepare(`
          INSERT INTO seller_bank (sellerId, accountName, accountNumber, ifscCode, bankName, upiId, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user.sellerId,
          fields.accountName,
          fields.accountNumber,
          fields.ifscCode,
          fields.bankName,
          fields.upiId,
          now()
        );
      }

      const bank = db
        .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
        .get(req.user.sellerId);

      res.json({ success: true, message: "Bank details saved.", bank });
    } catch (error) {
      console.error("SELLER BANK ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save bank details." });
    }
  }
);

// =====================================================
// SELLER PRODUCTS (AUTHENTICATED)
// =====================================================

function sellerOwnsProduct(sellerId, productId) {
  const product = db
    .prepare(`SELECT * FROM products WHERE id = ?`)
    .get(productId);

  if (!product) return { product: null };

  // Ownership: backend seller id/code, or legacy name matching.
  const seller = db
    .prepare(`SELECT * FROM sellers WHERE id = ?`)
    .get(sellerId);

  const ownsById =
    product.sellerId &&
    (String(product.sellerId) === String(seller?.sellerCode) ||
      String(product.sellerId) === String(sellerId));

  const ownsByName =
    seller &&
    product.sellerName &&
    String(product.sellerName).toLowerCase().trim() ===
      String(seller.name).toLowerCase().trim();

  return { product, owns: Boolean(ownsById || ownsByName) };
}

businessRouter.get(
  "/api/sellers/products",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    const byId = db
      .prepare(`SELECT * FROM products WHERE sellerId = ? ORDER BY id DESC`)
      .all(seller.sellerCode);

    const byLegacyId = db
      .prepare(`SELECT * FROM products WHERE sellerId = ? ORDER BY id DESC`)
      .all(String(seller.id));

    const byName = db
      .prepare(
        `SELECT * FROM products WHERE LOWER(sellerName) = LOWER(?) ORDER BY id DESC`
      )
      .all(seller.name);

    const merged = new Map();

    [...byId, ...byLegacyId, ...byName].forEach((product) =>
      merged.set(String(product.id), product)
    );

    res.json({ success: true, products: Array.from(merged.values()) });
  }
);

businessRouter.get(
  "/api/sellers/pricing-rules",
  requireAuth,
  requireType("seller"),
  (req, res) => res.json({ success: true, rules: getPricingRules() })
);

businessRouter.post(
  "/api/sellers/products",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(req.user.sellerId);
      const kyc = db.prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`).get(seller.id);

      if (!kyc || kyc.kycStatus !== "Approved") {
        return res.status(403).json({
          success: false,
          code: "KYC_REQUIRED",
          message: "Seller KYC approval is required before submitting products.",
          kycStatus: kyc?.kycStatus || "Pending",
        });
      }

      const name = clean(req.body.name);
      const category = clean(req.body.category);
      const price = clean(req.body.price);
      const hsnCode = clean(req.body.hsnCode);
      const gstRate = Math.max(0, Number(req.body.gstRate) || 0);

      if (!name || !category) return res.status(400).json({ success: false, message: "Product name and category are required." });
      if (!price || Number(String(price).replace(/[^0-9.]/g, "")) <= 0) return res.status(400).json({ success: false, message: "A valid price is required." });

      const pricing = calculateCustomerPricing(price, gstRate);
      const result = db.prepare(`
        INSERT INTO products (
          sellerId, sellerName, name, category, price, comparePrice,
          image, description, shortDetails, status, createdAt,
          hsnCode, gstRate, deliveryCharge, platformCharge, mlmCommission,
          customerPrice, pricingUpdatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seller.sellerCode, seller.name, name, category, price,
        clean(req.body.comparePrice), String(req.body.image || ""),
        clean(req.body.description), clean(req.body.shortDetails), now(),
        hsnCode, pricing.gstRate, pricing.deliveryCharge, pricing.platformCharge,
        pricing.mlmCommission, pricing.customerPrice, now()
      );

      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(result.lastInsertRowid);
      res.status(201).json({ success: true, message: "Product submitted for admin approval.", pricing, product });
    } catch (error) {
      console.error("SELLER ADD PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to add product." });
    }
  }
);
businessRouter.put(
  "/api/sellers/products/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const productId = Number(req.params.id);

      const { product, owns } = sellerOwnsProduct(req.user.sellerId, productId);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      if (!owns) {
        return res.status(403).json({ success: false, message: "You can only edit your own products." });
      }

      const name = req.body.name !== undefined ? clean(req.body.name) : product.name;
      const category = req.body.category !== undefined ? clean(req.body.category) : product.category;
      const price = req.body.price !== undefined ? clean(req.body.price) : product.price;
      const comparePrice = req.body.comparePrice !== undefined ? clean(req.body.comparePrice) : product.comparePrice;
      const image = req.body.image !== undefined ? String(req.body.image) : product.image;
      const description = req.body.description !== undefined ? clean(req.body.description) : product.description;
      const shortDetails = req.body.shortDetails !== undefined ? clean(req.body.shortDetails) : product.shortDetails;

      if (!name) {
        return res.status(400).json({ success: false, message: "Product name is required." });
      }

      // Edited products go back to admin approval.
      db.prepare(`
        UPDATE products
        SET name = ?, category = ?, price = ?, comparePrice = ?,
            image = ?, description = ?, shortDetails = ?, status = 'Pending'
        WHERE id = ?
      `).run(name, category, price, comparePrice, image, description, shortDetails, productId);

      const updated = db
        .prepare(`SELECT * FROM products WHERE id = ?`)
        .get(productId);

      res.json({
        success: true,
        message: "Product updated and resubmitted for admin approval.",
        product: updated,
      });
    } catch (error) {
      console.error("SELLER EDIT PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update product." });
    }
  }
);

// Seller deletes own product (ownership enforced).
businessRouter.delete(
  "/api/sellers/products/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const productId = Number(req.params.id);

      const { product, owns } = sellerOwnsProduct(req.user.sellerId, productId);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      if (!owns) {
        return res.status(403).json({ success: false, message: "You can only delete your own products." });
      }

      db.prepare(`DELETE FROM products WHERE id = ?`).run(productId);

      res.json({ success: true, message: "Product deleted." });
    } catch (error) {
      console.error("SELLER DELETE PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to delete product." });
    }
  }
);

// =====================================================
// SELLER ORDERS (OWN PRODUCTS ONLY)
// =====================================================

businessRouter.get(
  "/api/sellers/orders",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    // Orders that contain at least one item of this seller.
    const orders = db.prepare(`
      SELECT DISTINCT orders.*
      FROM orders
      JOIN order_items ON order_items.orderId = orders.id
      WHERE order_items.sellerId = ? OR order_items.sellerId = ?
      ORDER BY orders.id DESC
    `).all(seller.sellerCode, String(seller.id));

    res.json({
      success: true,
      orders: orders.map(orderWithItems),
    });
  }
);

// Seller updates fulfilment status of orders containing their products.
businessRouter.put(
  "/api/sellers/orders/:id/status",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const newStatus = clean(req.body.status);

      const allowed = ["Processing", "Shipped", "Delivered", "Cancelled"];

      if (!allowed.includes(newStatus)) {
        return res.status(400).json({ success: false, message: "Invalid order status." });
      }

      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(req.user.sellerId);

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      const ownItem = db
        .prepare(`
          SELECT id FROM order_items
          WHERE orderId = ? AND (sellerId = ? OR sellerId = ?)
          LIMIT 1
        `)
        .get(orderId, seller.sellerCode, String(seller.id));

      if (!ownItem) {
        return res.status(403).json({ success: false, message: "This order does not contain your products." });
      }

      applyOrderStatus(orderId, newStatus);

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: `Order status updated to ${newStatus}.`,
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("SELLER ORDER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update order status." });
    }
  }
);

// =====================================
// ORDER STATUS STATE MACHINE + COMMISSION HOOKS
// =====================================

function applyOrderStatus(orderId, newStatus) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

  if (!order) return;

  const updates = {
    status: newStatus,
    updatedAt: now(),
  };

  if (newStatus === "Delivered") {
    updates.deliveredAt = order.deliveredAt || now();
  }

  db.prepare(`
    UPDATE orders
    SET status = ?, updatedAt = ?, deliveredAt = ?
    WHERE id = ?
  `).run(newStatus, updates.updatedAt, updates.deliveredAt || order.deliveredAt, orderId);

  if (newStatus === "Delivered") {
    generateCommissionsForOrder({
      ...order,
      ...updates,
    });
  }

  if (["Cancelled", "Returned", "Refunded"].includes(newStatus)) {
    // Cancelled / returned orders do not generate commission.
    voidCommissionsForOrder(orderId);
  }
}

// =====================================================
// CUSTOMER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/customers/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");
      const referralCode = clean(req.body.referralCode);

      if (!name) {
        return res.status(400).json({ success: false, message: "Name is required." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existing = db
        .prepare(`SELECT id FROM customers WHERE mobile = ?`)
        .get(mobile);

      if (existing) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      let referredByMemberId = null;

      if (referralCode) {
        const member = db
          .prepare(
            `SELECT memberId FROM mlm_members WHERE referralCode = ? OR memberId = ?`
          )
          .get(referralCode, referralCode);

        if (!member) {
          return res.status(400).json({ success: false, message: "Invalid referral code." });
        }

        referredByMemberId = member.memberId;
      }

      const passwordHash = await hashPassword(password);

      const result = db.prepare(`
        INSERT INTO customers (name, mobile, email, passwordHash, referredByMemberId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, mobile, email || null, passwordHash, referredByMemberId, now());

      const customer = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(result.lastInsertRowid);

      const token = createToken({
        type: "customer",
        customerId: customer.id,
        name: customer.name,
      });

      res.status(201).json({
        success: true,
        message: "Account created successfully.",
        token,
        customer: publicCustomer(customer),
      });
    } catch (error) {
      console.error("CUSTOMER REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Registration failed." });
    }
  }
);

// =====================================================
// CUSTOMER LOGIN
// =====================================================

businessRouter.post(
  "/api/customers/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const mobile = clean(req.body.mobile);
      const password = String(req.body.password || "");

      if (!mobile || !password) {
        return res.status(400).json({ success: false, message: "Mobile and password are required." });
      }

      const customer = db
        .prepare(`SELECT * FROM customers WHERE mobile = ?`)
        .get(mobile);

      if (
        !customer ||
        !(await comparePassword(password, customer.passwordHash))
      ) {
        return res.status(401).json({ success: false, message: "Invalid mobile number or password." });
      }

      if (customer.status !== "active") {
        return res.status(403).json({ success: false, message: "This account is blocked." });
      }

      db.prepare(`UPDATE customers SET lastLoginAt = ? WHERE id = ?`).run(
        now(),
        customer.id
      );

      const token = createToken({
        type: "customer",
        customerId: customer.id,
        name: customer.name,
      });

      res.json({
        success: true,
        message: "Login successful.",
        token,
        customer: publicCustomer(customer),
      });
    } catch (error) {
      console.error("CUSTOMER LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Login failed." });
    }
  }
);

// =====================================================
// CUSTOMER PROFILE
// =====================================================

businessRouter.get(
  "/api/customers/me",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(req.user.customerId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    res.json({ success: true, customer: publicCustomer(customer) });
  }
);

// =====================================================
// PLACE ORDER (CUSTOMER)
// =====================================================
// Prices are always taken from approved backend products —
// never from client input.

businessRouter.post(
  "/api/orders",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : [];

      if (items.length === 0) {
        return res.status(400).json({ success: false, message: "Your cart is empty." });
      }

      const customer = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(req.user.customerId);

      if (!customer) {
        return res.status(404).json({ success: false, message: "Customer not found." });
      }

      const address = clean(req.body.address);
      const phone = clean(req.body.phone);

      if (!address || address.length < 10) {
        return res.status(400).json({ success: false, message: "A complete shipping address is required." });
      }

      if (!/^\d{10}$/.test(phone)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit phone number is required." });
      }

      const paymentMethod = ["COD", "UPI", "BankTransfer"].includes(
        req.body.paymentMethod
      )
        ? req.body.paymentMethod
        : "COD";

      // Validate all items against approved products.
      const resolvedItems = [];

      for (const item of items) {
        const productId = Number(item.productId || item.id);
        const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));

        const product = db
          .prepare(
            `SELECT * FROM products WHERE id = ? AND status = 'Approved'`
          )
          .get(productId);

        if (!product) {
          return res.status(400).json({
            success: false,
            message: `Product is unavailable: ${item.name || productId}`,
          });
        }

        resolvedItems.push({ product, quantity });
      }

      // Final customer prices are computed/stored by the backend.
      const totalAmount = resolvedItems.reduce(
        (sum, item) =>
          sum +
          Number(item.product.customerPrice || item.product.price || 0) *
            item.quantity,
        0
      );

      const orderNumber = `JB${Date.now()}${Math.floor(100 + Math.random() * 900)}`;

      const createOrder = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO orders (
            orderNumber, customerId, customerName, phone, address,
            totalAmount, paymentMethod, paymentStatus, status, createdAt, updatedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', 'Pending', ?, ?)
        `).run(
          orderNumber,
          customer.id,
          customer.name,
          phone,
          address,
          String(totalAmount),
          paymentMethod,
          now(),
          now()
        );

        const orderId = result.lastInsertRowid;

        resolvedItems.forEach(({ product, quantity }) => {
          db.prepare(`
            INSERT INTO order_items (orderId, productId, productName, sellerId, price, quantity)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            orderId,
            product.id,
            product.name,
            product.sellerId,
            product.price,
            quantity
          );
        });

        return orderId;
      });

      const orderId = createOrder();

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

      res.status(201).json({
        success: true,
        message: "Order placed successfully.",
        order: orderWithItems(order),
      });
    } catch (error) {
      console.error("PLACE ORDER ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to place order." });
    }
  }
);

// =====================================================
// CUSTOMER ORDERS
// =====================================================

businessRouter.get(
  "/api/customer/orders",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    const orders = db
      .prepare(`SELECT * FROM orders WHERE customerId = ? ORDER BY id DESC`)
      .all(req.user.customerId);

    res.json({ success: true, orders: orders.map(orderWithItems) });
  }
);

// Customer cancellation (own orders, before shipping).
businessRouter.put(
  "/api/customer/orders/:id/cancel",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order || order.customerId !== req.user.customerId) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      if (!["Pending", "Processing"].includes(order.status)) {
        return res.status(400).json({
          success: false,
          message: "This order can no longer be cancelled. Please contact support.",
        });
      }

      applyOrderStatus(orderId, "Cancelled");

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: "Order cancelled.",
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("CUSTOMER CANCEL ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to cancel order." });
    }
  }
);

// =====================================================
// MLM SETTINGS (PUBLIC READ — powers member UI)
// =====================================================

businessRouter.get("/api/mlm/settings", (req, res) => {
  res.json({ success: true, rules: getMlmRules() });
});

// =====================================================
// MLM MEMBER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/mlm/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");
      const referralCode = clean(req.body.referralCode);

      if (!name) {
        return res.status(400).json({ success: false, message: "Please enter member name." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existing = db
        .prepare(`SELECT id FROM mlm_members WHERE mobile = ?`)
        .get(mobile);

      if (existing) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      // Referrer: by referral code (or member ID). Optional — a member
      // without a referrer becomes a root of their own tree.
      let referrer = null;

      if (referralCode) {
        referrer = db
          .prepare(
            `SELECT * FROM mlm_members WHERE referralCode = ? OR memberId = ? LIMIT 1`
          )
          .get(referralCode, referralCode);

        if (!referrer) {
          return res.status(400).json({ success: false, message: "Invalid referral code." });
        }

        if (referrer.status !== "active") {
          return res.status(400).json({ success: false, message: "This referrer is not active." });
        }
      }

      const memberId = generateMemberId();
      const passwordHash = await hashPassword(password);

      let placement = { parentId: null, position: null };

      if (referrer) {
        placement = findPlacementFor(referrer);
      }

      const insertMember = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO mlm_members (
            memberId, name, mobile, email, passwordHash, referralCode, parentId, position, createdAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          memberId,
          name,
          mobile,
          email || null,
          passwordHash,
          memberId, // referral code defaults to member ID
          placement.parentId,
          placement.position,
          now()
        );

        db.prepare(`
          INSERT INTO mlm_wallets (memberId, balance, totalEarned, totalPaid, updatedAt)
          VALUES (?, 0, 0, 0, ?)
        `).run(memberId, now());

        return result.lastInsertRowid;
      });

      insertMember();

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
        .get(memberId);

      const token = createToken({
        type: "member",
        memberId: member.memberId,
        name: member.name,
      });

      res.status(201).json({
        success: true,
        message: `Registration successful! Member ID: ${memberId} | Position: ${placement.position || "ROOT"}`,
        token,
        member: publicMember(member),
      });
    } catch (error) {
      console.error("MLM REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Member registration failed." });
    }
  }
);

// =====================================================
// MLM MEMBER LOGIN
// =====================================================

businessRouter.post(
  "/api/mlm/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const memberId = clean(req.body.memberId).toUpperCase();
      const password = String(req.body.password || "");

      if (!memberId || !password) {
        return res.status(400).json({ success: false, message: "Member ID and password are required." });
      }

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE UPPER(memberId) = ?`)
        .get(memberId);

      if (!member || !(await comparePassword(password, member.passwordHash))) {
        return res.status(401).json({ success: false, message: "Member ID not found or incorrect password." });
      }

      if (member.status === "blocked") {
        return res.status(403).json({
          success: false,
          message: "Your Member Account is blocked. Please contact JustBrand Admin.",
        });
      }

      const token = createToken({
        type: "member",
        memberId: member.memberId,
        name: member.name,
      });

      res.json({
        success: true,
        message: `Welcome ${member.name}!`,
        token,
        member: publicMember(member),
      });
    } catch (error) {
      console.error("MLM LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Login failed." });
    }
  }
);

// =====================================
// MLM MEMBER MIDDLEWARE (LOAD MEMBER ROW)
// =====================================

function loadMember(req, res, next) {
  const member = db
    .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
    .get(req.user.memberId);

  if (!member) {
    return res.status(404).json({ success: false, message: "Member not found." });
  }

  if (member.status === "blocked") {
    return res.status(403).json({ success: false, message: "Your Member Account is blocked." });
  }

  req.member = member;
  next();
}

// =====================================================
// MLM DASHBOARD DATA
// =====================================================

businessRouter.get(
  "/api/mlm/me",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const member = req.member;

    const parent = member.parentId
      ? db
          .prepare(`SELECT memberId, name FROM mlm_members WHERE memberId = ?`)
          .get(member.parentId)
      : null;

    const children = db
      .prepare(
        `SELECT memberId, name, position, createdAt FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
      )
      .all(member.memberId);

    const teamSizeRow = db
      .prepare(`SELECT COUNT(*) AS count FROM mlm_members WHERE parentId = ?`)
      .get(member.memberId);

    const wallet = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(member.memberId) || {
      balance: 0,
      totalEarned: 0,
      totalPaid: 0,
    };

    const pendingRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM mlm_commissions WHERE memberId = ? AND status = 'Pending'`
      )
      .get(member.memberId);

    res.json({
      success: true,
      member: publicMember({ ...member, parentName: parent?.name || null }),
      directTeam: children,
      teamSize: teamSizeRow?.count || 0,
      wallet: {
        balance: wallet.balance || 0,
        totalEarned: wallet.totalEarned || 0,
        totalPaid: wallet.totalPaid || 0,
        pending: pendingRow?.total || 0,
      },
      rules: getMlmRules(),
    });
  }
);

// =====================================================
// MLM TREE (SUBTREE OF THE MEMBER)
// =====================================================

function buildSubtree(rootMember, depth) {
  const children = db
    .prepare(
      `SELECT memberId, name, position, createdAt FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
    )
    .all(rootMember.memberId);

  if (depth <= 0) return children;

  return children.map((child) => ({
    ...child,
    children: buildSubtree(child, depth - 1),
  }));
}

businessRouter.get(
  "/api/mlm/tree",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    const member = req.member;

    res.json({
      success: true,
      member: publicMember(member),
      maxDirect: MAX_DIRECT,
      children: buildSubtree(member, 2),
    });
  }
);

// =====================================================
// MLM WALLET
// =====================================================

businessRouter.get(
  "/api/mlm/wallet",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const wallet = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(req.member.memberId) || {
      balance: 0,
      totalEarned: 0,
      totalPaid: 0,
    };

    const pendingRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM mlm_commissions WHERE memberId = ? AND status = 'Pending'`
      )
      .get(req.member.memberId);

    res.json({
      success: true,
      wallet: {
        balance: wallet.balance || 0,
        totalEarned: wallet.totalEarned || 0,
        totalPaid: wallet.totalPaid || 0,
        pending: pendingRow?.total || 0,
      },
    });
  }
);

// =====================================================
// MLM COMMISSION RECORDS
// =====================================================

businessRouter.get(
  "/api/mlm/commissions",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const commissions = db
      .prepare(
        `SELECT * FROM mlm_commissions WHERE memberId = ? ORDER BY id DESC LIMIT 100`
      )
      .all(req.member.memberId);

    res.json({ success: true, commissions });
  }
);

// =====================================================
// MLM PAYOUT REQUEST (MEMBER)
// =====================================================
// Members can request a payout of their payable balance.
// The actual payment remains a restricted financial action
// performed by Super Admin / Accountant.

businessRouter.post(
  "/api/mlm/payout-request",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    try {
      releaseDueCommissions();

      const amount = Number(req.body.amount);
      const method = clean(req.body.method) || "Bank Account";

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "Please enter a valid withdrawal amount." });
      }

      if (amount < 100) {
        return res.status(400).json({ success: false, message: "Minimum withdrawal amount is ₹100." });
      }

      const wallet = db
        .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
        .get(req.member.memberId);

      if (!wallet || wallet.balance < amount) {
        return res.status(400).json({ success: false, message: "Insufficient available wallet balance." });
      }

      db.prepare(`
        INSERT INTO payout_requests (memberId, amount, method, status, createdAt)
        VALUES (?, ?, ?, 'Processing', ?)
      `).run(req.member.memberId, amount, method, now());

      res.json({
        success: true,
        message: "Payout request recorded. The JustBrand accounts team will process your payout.",
      });
    } catch (error) {
      console.error("MLM PAYOUT REQUEST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to record payout request." });
    }
  }
);

// =====================================================
// ADMIN: SELLER MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/sellers",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const sellers = db
      .prepare(`SELECT * FROM sellers ORDER BY id DESC`)
      .all();

    const withKyc = sellers.map((seller) => {
      const kyc = db
        .prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`)
        .get(seller.id);

      return { ...publicSeller(seller), kycStatus: kyc?.kycStatus || "Pending" };
    });

    res.json({ success: true, sellers: withKyc });
  }
);

// Seller detail including private KYC/bank data (staff only, never customers).
businessRouter.get(
  "/api/admin/sellers/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const kyc = db
      .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
      .get(seller.id);

    const bank = db
      .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
      .get(seller.id);

    res.json({
      success: true,
      seller: publicSeller(seller),
      kyc: kyc || null,
      bank: bank || null,
    });
  }
);

businessRouter.put(
  "/api/admin/sellers/:id/status",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const status = req.body.status === "suspended" ? "suspended" : "active";

    db.prepare(`UPDATE sellers SET status = ? WHERE id = ?`).run(status, seller.id);

    res.json({ success: true, message: `Seller ${status === "active" ? "activated" : "suspended"}.` });
  }
);

// KYC approve/reject (manager or super admin).
businessRouter.put(
  "/api/admin/sellers/:id/kyc",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const kycStatus = ["Approved", "Rejected", "Pending"].includes(req.body.kycStatus)
      ? req.body.kycStatus
      : "Pending";

    db.prepare(`
      INSERT INTO seller_kyc (sellerId, kycStatus, rejectionReason, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sellerId) DO UPDATE SET
        kycStatus = excluded.kycStatus,
        rejectionReason = excluded.rejectionReason,
        updatedAt = excluded.updatedAt
    `).run(seller.id, kycStatus, clean(req.body.rejectionReason) || null, now());

    res.json({ success: true, message: `Seller KYC marked ${kycStatus}.` });
  }
);

// =====================================================
// ADMIN: ORDER MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/orders",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const orders = db
      .prepare(`SELECT * FROM orders ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, orders: orders.map(orderWithItems) });
  }
);

businessRouter.put(
  "/api/admin/orders/:id/status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const newStatus = clean(req.body.status);

      const allowed = [
        "Pending",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Returned",
        "Refunded",
      ];

      if (!allowed.includes(newStatus)) {
        return res.status(400).json({ success: false, message: "Invalid order status." });
      }

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      applyOrderStatus(orderId, newStatus);

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: `Order status updated to ${newStatus}.`,
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("ADMIN ORDER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update order status." });
    }
  }
);

// Payment verification is a FINANCIAL action: accountant or super admin only.
businessRouter.put(
  "/api/admin/orders/:id/payment",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const orderId = Number(req.params.id);

    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const paymentStatus = ["Pending", "Paid", "Refunded"].includes(req.body.paymentStatus)
      ? req.body.paymentStatus
      : "Pending";

    db.prepare(`
      UPDATE orders
      SET paymentStatus = ?, paymentRef = ?, updatedAt = ?
      WHERE id = ?
    `).run(paymentStatus, clean(req.body.paymentRef) || order.paymentRef, now(), orderId);

    res.json({ success: true, message: `Payment marked ${paymentStatus}.` });
  }
);

// =====================================================
// ADMIN: CUSTOMERS
// =====================================================

businessRouter.get(
  "/api/admin/customers",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const customers = db
      .prepare(`SELECT * FROM customers ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, customers: customers.map(publicCustomer) });
  }
);

// =====================================================
// ADMIN: MLM MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/mlm/members",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const members = db
      .prepare(`SELECT * FROM mlm_members ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, members: members.map(publicMember) });
  }
);

businessRouter.put(
  "/api/admin/mlm/members/:memberId/status",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const member = db
      .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
      .get(clean(req.params.memberId));

    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found." });
    }

    const status = req.body.status === "blocked" ? "blocked" : "active";

    db.prepare(`UPDATE mlm_members SET status = ? WHERE memberId = ?`).run(
      status,
      member.memberId
    );

    res.json({ success: true, message: `Member ${status === "blocked" ? "blocked" : "activated"}.` });
  }
);

businessRouter.get(
  "/api/admin/mlm/settings",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    res.json({ success: true, rules: getMlmRules() });
  }
);

businessRouter.put(
  "/api/admin/mlm/settings",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const current = getMlmRules();

      const numericKeys = [
        "directCommission",
        "levelCommission",
        "binaryCommission",
        "shoppingCommission",
        "returnPeriodDays",
        "directMemberLimit",
      ];

      const next = { ...current };

      numericKeys.forEach((key) => {
        if (req.body[key] !== undefined) {
          const value = Number(req.body[key]);
          if (Number.isFinite(value) && value >= 0) {
            next[key] = value;
          }
        }
      });

      [
        "commissionAfterReturn",
        "cancelCommission",
        "returnCommission",
      ].forEach((key) => {
        if (typeof req.body[key] === "boolean") {
          next[key] = req.body[key];
        }
      });

      // Business guard: cancelled/returned orders must not earn commission.
      next.cancelCommission = false;
      next.returnCommission = false;

      saveMlmRules(next);

      res.json({ success: true, message: "Commission rules updated.", rules: next });
    } catch (error) {
      console.error("ADMIN MLM SETTINGS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update commission rules." });
    }
  }
);

// Release due commissions (also runs automatically on member reads).
businessRouter.post(
  "/api/admin/mlm/commissions/release",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    releaseDueCommissions();

    const totals = db
      .prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM mlm_commissions GROUP BY status`
      )
      .all();

    res.json({ success: true, message: "Due commissions processed.", totals });
  }
);

// All commissions (restricted financial view).
businessRouter.get(
  "/api/admin/mlm/commissions",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const commissions = db
      .prepare(`SELECT * FROM mlm_commissions ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, commissions });
  }
);

// Payout requests (financial action).
businessRouter.get(
  "/api/admin/mlm/payouts",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const payouts = db
      .prepare(`SELECT * FROM payout_requests ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, payouts });
  }
);

// Process a payout request: debit wallet and mark paid.
businessRouter.put(
  "/api/admin/mlm/payouts/:id",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const payout = db
      .prepare(`SELECT * FROM payout_requests WHERE id = ?`)
      .get(Number(req.params.id));

    if (!payout) {
      return res.status(404).json({ success: false, message: "Payout request not found." });
    }

    if (payout.status !== "Processing") {
      return res.status(400).json({ success: false, message: "This payout request was already processed." });
    }

    const processPayout = db.transaction(() => {
      db.prepare(
        `UPDATE payout_requests SET status = 'Paid', processedAt = ? WHERE id = ?`
      ).run(now(), payout.id);

      db.prepare(`
        UPDATE mlm_wallets
        SET balance = balance - ?, totalPaid = totalPaid + ?, updatedAt = ?
        WHERE memberId = ?
      `).run(payout.amount, payout.amount, now(), payout.memberId);
    });

    processPayout();

    res.json({ success: true, message: "Payout marked as paid." });
  }
);

// Mark a payable commission as actually paid (financial action).
businessRouter.put(
  "/api/admin/mlm/commissions/:id/paid",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const commission = db
      .prepare(`SELECT * FROM mlm_commissions WHERE id = ?`)
      .get(Number(req.params.id));

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission record not found." });
    }

    if (commission.status !== "Payable") {
      return res.status(400).json({
        success: false,
        message: "Only Payable commissions can be marked paid.",
      });
    }

    const markPaid = db.transaction(() => {
      db.prepare(
        `UPDATE mlm_commissions SET status = 'Paid', paidAt = ? WHERE id = ?`
      ).run(now(), commission.id);

      db.prepare(`
        UPDATE mlm_wallets
        SET balance = balance - ?, totalPaid = totalPaid + ?, updatedAt = ?
        WHERE memberId = ?
      `).run(commission.amount, commission.amount, now(), commission.memberId);
    });

    markPaid();

    res.json({ success: true, message: "Commission marked as paid." });
  }
);

// =====================================================
// INIT + DEFAULT EXPORT
// =====================================================
// All table creation statements above are CREATE TABLE IF NOT EXISTS
// and run idempotently when this module is loaded; initBusiness()
// is the explicit hook called by server.js so the initialization
// order stays visible in one place.

export function initBusiness() {
  console.log("Business tables ready (sellers, customers, orders, MLM).");
}

export default businessRouter;

// =====================================================
// JUSTBRAND — PROTECTED PRODUCT CHAT (Phase 2, ADDITIVE)
// =====================================================
// Buyer ↔ Seller chat scoped to a single product (optional order
// context). Design rules:
//   - All tables are CREATE TABLE IF NOT EXISTS (additive only).
//   - Contact information (phone / mobile / email / WhatsApp /
//     contact phrases, incl. obfuscated spaced digits and spaced
//     emails) is redacted ON THE BACKEND before the message is
//     stored as the deliverable copy or sent to the other party.
//   - The unredacted original is kept ONLY in a private column for
//     moderation/audit and is NEVER returned by any API.
//   - Buyer sees only threads on products they view; seller sees
//     only threads on THEIR OWN products (checked server-side).
//   - No seller phone / email / address is ever included in any
//     chat response.
//   - Existing order / payment / delivery logic is untouched.
// =====================================================

import express from "express";
import db from "./db.js";
import { requireAuth, requireType } from "./auth.js";

export const chatRouter = express.Router();

// =====================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    productName TEXT,
    buyerId INTEGER NOT NULL,
    sellerId TEXT NOT NULL,
    orderId INTEGER,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    threadId INTEGER NOT NULL,
    senderType TEXT NOT NULL,
    senderId TEXT NOT NULL,
    originalText TEXT,
    message TEXT NOT NULL,
    redacted INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_buyer ON chat_threads (buyerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_seller ON chat_threads (sellerId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_chat_threads_product ON chat_threads (productId)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages (threadId)`
).run();

console.log("Chat tables ready.");

// =====================================
// CONTACT-INFO REDACTION ENGINE
// =====================================
// Runs on the backend BEFORE storing/delivering. Returns the cleaned
// text plus whether anything was removed. Patterns cover the common
// obfuscations: raw numbers, +91 numbers, spaced digit groups,
// digit groups with separators, standard and spaced emails,
// "user at gmail dot com" style, WhatsApp/telegram phrases,
// "call me", "my number", "contact me", "my address" etc.

const REDACTION_MARKER = "[contact hidden]";

const EMAIL_PATTERNS = [
  // user@domain.tld (standard) and user @ domain . tld (spaced)
  /[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\s*\.\s*[A-Za-z]{2,}/g,
  // "john at gmail dot com" / "john at gmail . com"
  /\b[A-Za-z0-9._%+-]+\s+(?:at|@)\s+[A-Za-z0-9.-]+\s+(?:dot|\.)\s+[A-Za-z]{2,}\b/gi,
];

const PHONE_PATTERNS = [
  // 9+ digits with optional single separators (covers 9876543210,
  // 98765 43210, 98765-43210, 9 8 7 6 5 4 3 2 1 0, +91 98765 43210)
  /\+?\d(?:[\s.\-]?\d){8,}/g,
  // digit groups like 98765 43 210 with wider spacing
  /(?:\b\d{2,6}\s+){2,}\d{2,6}\b/g,
];

const PHRASE_PATTERNS = [
  // messaging apps / contact services
  /\b(?:whats\s*app|whatsapp|wa\s*\.\s*me|telegram|signal|imo)\b/gi,
  // invitations to exchange contact
  /\b(?:call|text|sms|ring)\s+me\b/gi,
  /\bcontact\s+me\b/gi,
  // contact-number phrases (english + common hinglish)
  /\b(?:mobile|phone|contact|whatsapp|call)\s*(?:number|no\.?|num\.?)\b/gi,
  /\bmy\s+(?:number|no\.?|mobile|phone|contact)\b/gi,
  /\b(?:number|no\.?)\s+(?:bhejo|bataao|batao|do|share|send)\b/gi,
  /\b(?:call|whatsapp|phone)\s+(?:karo|karein|kar)\b/gi,
  // email-exchange phrases
  /\b(?:my|your)\s+e-?mail\b/gi,
  /\be-?mail\s+(?:me|id|address|bhejo|do|share)\b/gi,
  // address sharing
  /\b(?:my|home|full)\s+(?:home\s+)?address\s*(?:is|:)?/gi,
];

export function redactContactInfo(text) {
  const original = String(text ?? "");
  let cleaned = original;
  let hits = 0;

  const run = (patterns) => {
    for (const pattern of patterns) {
      // Fresh regex each run (g-flag lastIndex safety).
      const re = new RegExp(pattern.source, pattern.flags);
      cleaned = cleaned.replace(re, () => {
        hits += 1;
        return REDACTION_MARKER;
      });
    }
  };

  run(EMAIL_PATTERNS);
  run(PHONE_PATTERNS);
  run(PHRASE_PATTERNS);

  // Collapse repeated markers into one. The marker must be
  // regex-escaped — its square brackets would otherwise be a
  // character class and eat the whole message.
  const escapedMarker = REDACTION_MARKER.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  cleaned = cleaned
    .replace(new RegExp(`(?:\\s*${escapedMarker}\\s*)+`, "g"), ` ${REDACTION_MARKER} `)
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, redacted: hits > 0, hits };
}

// =====================================
// HELPERS
// =====================================

function now() {
  return new Date().toISOString();
}

function getThread(id) {
  return db.prepare(`SELECT * FROM chat_threads WHERE id = ?`).get(Number(id));
}

// products.sellerId stores the seller's sellerCode (TEXT), while seller
// JWT tokens carry the numeric sellers.id. Normalize either form to the
// numeric sellers.id so thread rows and ownership checks always agree.
function resolveSellerId(rawSellerId) {
  if (rawSellerId === undefined || rawSellerId === null || rawSellerId === "") {
    return null;
  }
  const byId = db
    .prepare(`SELECT id FROM sellers WHERE id = ?`)
    .get(Number(rawSellerId));
  if (byId) return String(byId.id);
  const byCode = db
    .prepare(`SELECT id FROM sellers WHERE sellerCode = ?`)
    .get(String(rawSellerId));
  if (byCode) return String(byCode.id);
  return String(rawSellerId);
}

// Buyer participant check (server-side, never frontend-only).
function buyerOwnsThread(thread, customerId) {
  return Boolean(thread) && Number(thread.buyerId) === Number(customerId);
}

// Seller participant check — a seller only ever touches threads that
// belong to THEIR OWN products (cross-seller isolation). Matches both
// the normalized numeric id and a legacy sellerCode row.
function sellerOwnsThread(thread, sellerId) {
  if (!thread) return false;
  const sid = String(sellerId);
  if (String(thread.sellerId) === sid) return true;
  const me = db
    .prepare(`SELECT id, sellerCode FROM sellers WHERE id = ?`)
    .get(Number(sid));
  return Boolean(
    me &&
      (String(thread.sellerId) === String(me.id) ||
        String(thread.sellerId) === String(me.sellerCode))
  );
}

// Seller ids that identify this seller's threads (numeric id + legacy
// sellerCode form), for the seller thread-list query.
function sellerThreadIdValues(sellerId) {
  const values = [String(sellerId)];
  const me = db
    .prepare(`SELECT sellerCode FROM sellers WHERE id = ?`)
    .get(Number(sellerId));
  if (me?.sellerCode && !values.includes(String(me.sellerCode))) {
    values.push(String(me.sellerCode));
  }
  return values;
}

function lastMessageOf(threadId) {
  return db
    .prepare(
      `SELECT message, createdAt FROM chat_messages WHERE threadId = ? ORDER BY id DESC LIMIT 1`
    )
    .get(Number(threadId));
}

function publicMessages(threadId) {
  // NOTE: originalText is intentionally NEVER selected here.
  return db
    .prepare(
      `SELECT id, senderType, message, redacted, createdAt
       FROM chat_messages WHERE threadId = ? ORDER BY id ASC LIMIT 500`
    )
    .all(Number(threadId))
    .map((m) => ({ ...m, redacted: m.redacted === 1 }));
}

// Seller label for a buyer — shop/name only, NEVER phone/email/address.
function sellerLabel(thread) {
  const product = db
    .prepare(`SELECT sellerName FROM products WHERE id = ?`)
    .get(Number(thread.productId));
  const seller = db
    .prepare(`SELECT name, shopName FROM sellers WHERE id = ?`)
    .get(Number(thread.sellerId));
  return (
    seller?.shopName ||
    seller?.name ||
    product?.sellerName ||
    "JustBrand Seller"
  );
}

// Buyer label for a seller — name only, no phone/email/address.
function buyerLabel(thread) {
  const buyer = db
    .prepare(`SELECT name FROM customers WHERE id = ?`)
    .get(Number(thread.buyerId));
  return buyer?.name || "Buyer";
}

function publicThreadForBuyer(thread) {
  const last = lastMessageOf(thread.id);
  return {
    id: thread.id,
    productId: thread.productId,
    productName: thread.productName,
    orderId: thread.orderId || null,
    displayName: sellerLabel(thread),
    lastMessage: last?.message || "",
    lastMessageAt: last?.createdAt || thread.createdAt,
    updatedAt: thread.updatedAt || thread.createdAt,
  };
}

function publicThreadForSeller(thread) {
  const last = lastMessageOf(thread.id);
  return {
    id: thread.id,
    productId: thread.productId,
    productName: thread.productName,
    orderId: thread.orderId || null,
    displayName: buyerLabel(thread),
    lastMessage: last?.message || "",
    lastMessageAt: last?.createdAt || thread.createdAt,
    updatedAt: thread.updatedAt || thread.createdAt,
  };
}

// =====================================
// BUYER ROUTES (customer tokens only)
// =====================================

// Open (or reuse) a product-scoped thread.
chatRouter.post(
  "/api/chat/threads",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const productId = Number(req.body?.productId);
      if (!Number.isInteger(productId) || productId <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "A valid product is required." });
      }

      const product = db
        .prepare(`SELECT id, name, sellerId, status FROM products WHERE id = ?`)
        .get(productId);

      if (!product) {
        return res
          .status(404)
          .json({ success: false, message: "Product not found." });
      }

      if (!product.sellerId) {
        return res.status(400).json({
          success: false,
          message: "This product has no seller to chat with.",
        });
      }

      // Optional order context must belong to THIS buyer.
      let orderId = null;
      if (req.body?.orderId !== undefined && req.body?.orderId !== null) {
        const candidate = Number(req.body.orderId);
        const order = candidate
          ? db
              .prepare(`SELECT id FROM orders WHERE id = ? AND customerId = ?`)
              .get(candidate, req.user.customerId)
          : null;
        if (!order) {
          return res.status(403).json({
            success: false,
            message: "That order does not belong to you.",
          });
        }
        orderId = order.id;
      }

      const existing = db
        .prepare(
          `SELECT * FROM chat_threads WHERE productId = ? AND buyerId = ?`
        )
        .get(productId, req.user.customerId);

      if (existing) {
        return res.json({
          success: true,
          thread: publicThreadForBuyer(existing),
        });
      }

      // Store the NUMERIC seller id (resolve sellerCode if needed) so
      // seller ownership checks and lists always match.
      const threadSellerId = resolveSellerId(product.sellerId);

      const info = db
        .prepare(
          `INSERT INTO chat_threads (productId, productName, buyerId, sellerId, orderId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          productId,
          product.name,
          req.user.customerId,
          threadSellerId,
          orderId,
          now(),
          now()
        );

      const thread = getThread(info.lastInsertRowid);
      res.status(201).json({
        success: true,
        thread: publicThreadForBuyer(thread),
      });
    } catch (error) {
      console.error("CHAT THREAD CREATE ERROR:", error.message);
      res.status(500).json({ success: false, message: "Could not open chat." });
    }
  }
);

// Buyer's own threads only.
chatRouter.get(
  "/api/chat/threads",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const threads = db
        .prepare(
          `SELECT * FROM chat_threads WHERE buyerId = ? ORDER BY COALESCE(updatedAt, createdAt) DESC LIMIT 100`
        )
        .all(req.user.customerId);

      res.json({
        success: true,
        threads: threads.map(publicThreadForBuyer),
      });
    } catch (error) {
      console.error("CHAT THREADS READ ERROR:", error.message);
      res.status(500).json({ success: false, message: "Could not load chats." });
    }
  }
);

// =====================================
// SELLER ROUTES (seller tokens only)
// =====================================

// Threads on the seller's OWN products only (cross-seller isolation).
chatRouter.get(
  "/api/chat/threads/seller",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const ids = sellerThreadIdValues(req.user.sellerId);
      const placeholders = ids.map(() => "?").join(", ");
      const threads = db
        .prepare(
          `SELECT * FROM chat_threads WHERE sellerId IN (${placeholders}) ORDER BY COALESCE(updatedAt, createdAt) DESC LIMIT 100`
        )
        .all(...ids);

      res.json({
        success: true,
        threads: threads.map(publicThreadForSeller),
      });
    } catch (error) {
      console.error("SELLER CHAT THREADS ERROR:", error.message);
      res.status(500).json({ success: false, message: "Could not load chats." });
    }
  }
);

// =====================================
// SHARED THREAD ROUTES (both sides, participant-checked)
// =====================================

chatRouter.get(
  "/api/chat/threads/:id/messages",
  requireAuth,
  (req, res) => {
    try {
      const thread = getThread(req.params.id);
      const isBuyer =
        req.user?.type === "customer" && buyerOwnsThread(thread, req.user.customerId);
      const isSeller =
        req.user?.type === "seller" && sellerOwnsThread(thread, req.user.sellerId);

      // Non-participants get 404 — thread existence is not leaked.
      if (!isBuyer && !isSeller) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found." });
      }

      res.json({
        success: true,
        thread:
          isBuyer ? publicThreadForBuyer(thread) : publicThreadForSeller(thread),
        messages: publicMessages(thread.id),
      });
    } catch (error) {
      console.error("CHAT MESSAGES READ ERROR:", error.message);
      res.status(500).json({ success: false, message: "Could not load messages." });
    }
  }
);

chatRouter.post(
  "/api/chat/threads/:id/messages",
  requireAuth,
  (req, res) => {
    try {
      const thread = getThread(req.params.id);
      const isBuyer =
        req.user?.type === "customer" && buyerOwnsThread(thread, req.user.customerId);
      const isSeller =
        req.user?.type === "seller" && sellerOwnsThread(thread, req.user.sellerId);

      if (!isBuyer && !isSeller) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found." });
      }

      const raw = String(req.body?.message ?? "").trim();
      if (!raw) {
        return res
          .status(400)
          .json({ success: false, message: "Message cannot be empty." });
      }
      if (raw.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Message must be 2000 characters or fewer.",
        });
      }

      // ===== BACKEND REDACTION (before store + before delivery) =====
      const { cleaned, redacted } = redactContactInfo(raw);
      const deliverable = cleaned || REDACTION_MARKER;

      const senderType = isBuyer ? "buyer" : "seller";
      const senderId = isBuyer
        ? String(req.user.customerId)
        : String(req.user.sellerId);

      const info = db
        .prepare(
          `INSERT INTO chat_messages (threadId, senderType, senderId, originalText, message, redacted, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          thread.id,
          senderType,
          senderId,
          raw, // private moderation copy — NEVER returned by any API
          deliverable,
          redacted ? 1 : 0,
          now()
        );

      db.prepare(`UPDATE chat_threads SET updatedAt = ? WHERE id = ?`).run(
        now(),
        thread.id
      );

      const created = db
        .prepare(
          `SELECT id, senderType, message, redacted, createdAt FROM chat_messages WHERE id = ?`
        )
        .get(info.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: { ...created, redacted: created.redacted === 1 },
      });
    } catch (error) {
      console.error("CHAT MESSAGE SEND ERROR:", error.message);
      res.status(500).json({ success: false, message: "Could not send message." });
    }
  }
);

export default chatRouter;

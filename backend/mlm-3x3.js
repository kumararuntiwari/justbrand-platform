// =====================================================
// JUSTBRAND FAMILY — 3×3 DIRECT / SPILLOVER / TIMEWISE
// =====================================================
// ADDITIVE ENGINE. The existing mlm_commissions flow, shopping
// reward, level rewards, placement engine and wallet release logic
// are not modified. This module adds:
//
//   • referral attribution separate from tree placement
//   • one settings row per earning type + append-only audit
//   • an immutable per-order rule snapshot (old orders keep old rates)
//   • source-scoped rows in the SAME mlm_commissions ledger
//   • a UNIQUE(orderId, memberId) guard for the new sources, so one
//     order can never pay the same member twice through this engine
//
// All amounts are calculated server-side from the order's immutable
// snapshot. Nothing is accepted from the browser.

import db from "./db.js";

const TYPES = ["direct", "spillover", "timewise"];
const SOURCE = {
  direct: "3x3_direct",
  spillover: "3x3_spillover",
  timewise: "3x3_timewise",
};
const TYPE_LABEL = {
  direct: "Direct Introduce",
  spillover: "Spillover",
  timewise: "Time-wise Shopping Chain",
};
const BASES = ["order_total", "product_total", "items_total", "taxable_total"];
const MAX_DIRECT_INTRODUCTIONS = 3;

const DEFAULTS = {
  direct: {
    enabled: false,
    percentage: 5,
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    calculationBase: "product_total",
    maxLevels: 1,
    chainLimit: 1,
  },
  spillover: {
    enabled: false,
    percentage: 3,
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    calculationBase: "product_total",
    maxLevels: 1,
    chainLimit: 1,
  },
  timewise: {
    enabled: false,
    percentage: 2,
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    calculationBase: "product_total",
    maxLevels: 3,
    chainLimit: 3,
  },
};

function now() {
  return new Date().toISOString();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  // Admin date fields are IST calendar dates. Persist the exact
  // server-side instant so orders can be compared deterministically.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00+05:30`)
    : new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function hasColumn(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export function initMlm3x3() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mlm_3x3_settings (
      earningType TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      percentage REAL NOT NULL DEFAULT 0,
      effectiveFrom TEXT NOT NULL,
      calculationBase TEXT NOT NULL DEFAULT 'product_total',
      maxLevels INTEGER NOT NULL DEFAULT 1,
      chainLimit INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT,
      updatedBy TEXT
    )
  `).run();

  for (const type of TYPES) {
    const defaults = DEFAULTS[type];
    db.prepare(`
      INSERT INTO mlm_3x3_settings (
        earningType, enabled, percentage, effectiveFrom, calculationBase,
        maxLevels, chainLimit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(earningType) DO NOTHING
    `).run(
      type,
      defaults.enabled ? 1 : 0,
      defaults.percentage,
      defaults.effectiveFrom,
      defaults.calculationBase,
      defaults.maxLevels,
      defaults.chainLimit
    );
    // Existing installs that already have this row keep their values.
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS mlm_3x3_settings_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      beforeJson TEXT,
      afterJson TEXT,
      note TEXT
    )
  `).run();

  // Referral attribution is recorded separately from actual tree
  // placement (mlm_placements). A sponsor can refer more than three
  // people; the first three are "direct introductions", the rest are
  // "spillover introductions". Placement never rejects the fourth.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mlm_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsorId TEXT NOT NULL,
      memberId TEXT NOT NULL UNIQUE,
      introductionType TEXT NOT NULL,
      directSlot INTEGER,
      createdAt TEXT NOT NULL,
      note TEXT
    )
  `).run();

  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mlm_referrals_direct_slot
    ON mlm_referrals(sponsorId, directSlot)
    WHERE introductionType = 'direct'
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_mlm_referrals_sponsor
    ON mlm_referrals(sponsorId)
  `).run();

  // Immutable rule snapshot captured when the order is placed. The
  // delivery-time engine reads this — later admin percentage edits can
  // never rewrite an existing order's rate.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS mlm_3x3_order_snapshots (
      orderId INTEGER PRIMARY KEY,
      orderNumber TEXT,
      memberId TEXT,
      shoppingAt TEXT NOT NULL,
      settingsJson TEXT NOT NULL,
      basesJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS mlm_3x3_commission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      commissionId INTEGER,
      orderId INTEGER,
      memberId TEXT,
      source TEXT,
      amount REAL,
      details TEXT
    )
  `).run();

  // Columns added to the existing ledger. Existing rows keep NULL in
  // these fields, so every legacy commission/wallet/release behaviour
  // is unchanged.
  addColumn("mlm_commissions", "source", "TEXT");
  addColumn("mlm_commissions", "percentage", "REAL");
  addColumn("mlm_commissions", "base_amount", "REAL");
  addColumn("mlm_commissions", "calculation_base", "TEXT");
  addColumn("mlm_commissions", "rule_snapshot_json", "TEXT");
  addColumn("mlm_commissions", "eligible_at", "TEXT");
  addColumn("mlm_commissions", "settings_effective_from", "TEXT");

  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mlm_commissions_3x3_once
    ON mlm_commissions(orderId, memberId)
    WHERE source IS NOT NULL AND orderId IS NOT NULL
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_mlm_commissions_3x3_source
    ON mlm_commissions(source)
    WHERE source IS NOT NULL
  `).run();
}

function normalizeSettingsRow(row, type) {
  const fallback = DEFAULTS[type];
  if (!row) return { ...fallback };
  return {
    enabled: Number(row.enabled) === 1,
    percentage: Number(row.percentage) || 0,
    effectiveFrom: row.effectiveFrom || fallback.effectiveFrom,
    calculationBase: BASES.includes(row.calculationBase)
      ? row.calculationBase
      : fallback.calculationBase,
    maxLevels: Number(row.maxLevels) || fallback.maxLevels,
    chainLimit: Number(row.chainLimit) || fallback.chainLimit,
    updatedAt: row.updatedAt || null,
    updatedBy: row.updatedBy || null,
  };
}

export function getMlm3x3Settings() {
  const rows = db.prepare(`SELECT * FROM mlm_3x3_settings`).all();
  const byType = new Map(rows.map((row) => [row.earningType, row]));
  return Object.fromEntries(
    TYPES.map((type) => [type, normalizeSettingsRow(byType.get(type), type)])
  );
}

function validateSettings(input) {
  const next = getMlm3x3Settings();
  const errors = [];

  for (const type of TYPES) {
    const raw = input?.[type];
    if (raw === undefined) continue;

    const current = next[type];
    const enabled =
      typeof raw.enabled === "boolean" ? raw.enabled : current.enabled;
    const percentage =
      raw.percentage === undefined ? current.percentage : Number(raw.percentage);
    const maxLevels =
      raw.maxLevels === undefined ? current.maxLevels : Number(raw.maxLevels);
    const chainLimit =
      raw.chainLimit === undefined ? current.chainLimit : Number(raw.chainLimit);
    const calculationBase =
      raw.calculationBase === undefined
        ? current.calculationBase
        : String(raw.calculationBase);
    const effectiveFrom =
      raw.effectiveFrom === undefined
        ? current.effectiveFrom
        : isoDateOnly(raw.effectiveFrom);

    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      errors.push(`${TYPE_LABEL[type]} percentage must be between 0 and 100.`);
    }
    if (!Number.isInteger(maxLevels) || maxLevels < 1 || maxLevels > 9) {
      errors.push(`${TYPE_LABEL[type]} levels must be a whole number from 1 to 9.`);
    }
    if (!Number.isInteger(chainLimit) || chainLimit < 1 || chainLimit > 9) {
      errors.push(`${TYPE_LABEL[type]} chain limit must be a whole number from 1 to 9.`);
    }
    if (!BASES.includes(calculationBase)) {
      errors.push(`${TYPE_LABEL[type]} has an unsupported calculation base.`);
    }
    if (!effectiveFrom) {
      errors.push(`${TYPE_LABEL[type]} effective date is invalid.`);
    }

    next[type] = {
      ...current,
      enabled,
      percentage,
      effectiveFrom: effectiveFrom || current.effectiveFrom,
      calculationBase,
      maxLevels,
      chainLimit,
    };
  }

  return { next, errors };
}

export function saveMlm3x3Settings(input, actor, note = "") {
  const { next, errors } = validateSettings(input);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.status = 400;
    error.errors = errors;
    throw error;
  }

  const before = getMlm3x3Settings();
  const changed = TYPES.some((type) => {
    const a = before[type];
    const b = next[type];
    return (
      a.enabled !== b.enabled ||
      Number(a.percentage) !== Number(b.percentage) ||
      a.effectiveFrom !== b.effectiveFrom ||
      a.calculationBase !== b.calculationBase ||
      Number(a.maxLevels) !== Number(b.maxLevels) ||
      Number(a.chainLimit) !== Number(b.chainLimit)
    );
  });

  if (!changed) return { settings: before, changed: false };

  const save = db.transaction(() => {
    for (const type of TYPES) {
      const row = next[type];
      db.prepare(`
        UPDATE mlm_3x3_settings
        SET enabled = ?, percentage = ?, effectiveFrom = ?, calculationBase = ?,
            maxLevels = ?, chainLimit = ?, updatedAt = ?, updatedBy = ?
        WHERE earningType = ?
      `).run(
        row.enabled ? 1 : 0,
        row.percentage,
        row.effectiveFrom,
        row.calculationBase,
        row.maxLevels,
        row.chainLimit,
        now(),
        actor,
        type
      );
    }

    db.prepare(`
      INSERT INTO mlm_3x3_settings_audit (at, actor, beforeJson, afterJson, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(now(), actor, JSON.stringify(before), JSON.stringify(next), note || null);
  });

  save();

  return {
    settings: getMlm3x3Settings(),
    changed: true,
    before,
    after: getMlm3x3Settings(),
  };
}

export function listMlm3x3SettingsAudit(limit = 100) {
  return db
    .prepare(`SELECT * FROM mlm_3x3_settings_audit ORDER BY id DESC LIMIT ?`)
    .all(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .map((row) => ({
      ...row,
      before: parseJson(row.beforeJson, null),
      after: parseJson(row.afterJson, null),
    }));
}

// Called at order placement. Even when every type is disabled, the
// snapshot is stored so the order's authoritative shopping timestamp
// and unique order ID remain auditable.
export function captureMlm3x3OrderSnapshot({
  orderId,
  orderNumber,
  shoppingAt,
  phone,
  bases,
}) {
  const member = db
    .prepare(`SELECT memberId FROM mlm_members WHERE mobile = ? LIMIT 1`)
    .get(String(phone || "").trim());

  const current = getMlm3x3Settings();
  const active = {};

  for (const type of TYPES) {
    const rule = current[type];
    const effective = Boolean(rule.enabled) &&
      String(rule.effectiveFrom || "") <= String(shoppingAt || "");
    active[type] = {
      enabled: effective,
      percentage: effective ? Number(rule.percentage) : 0,
      effectiveFrom: rule.effectiveFrom,
      calculationBase: rule.calculationBase,
      maxLevels: Number(rule.maxLevels),
      chainLimit: Number(rule.chainLimit),
    };
  }

  db.prepare(`
    INSERT INTO mlm_3x3_order_snapshots (
      orderId, orderNumber, memberId, shoppingAt, settingsJson, basesJson, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(orderId) DO NOTHING
  `).run(
    orderId,
    orderNumber || null,
    member?.memberId || null,
    shoppingAt || now(),
    JSON.stringify(active),
    JSON.stringify(bases || {}),
    now()
  );
}

function getOrderSnapshot(orderId) {
  const row = db
    .prepare(`SELECT * FROM mlm_3x3_order_snapshots WHERE orderId = ?`)
    .get(orderId);
  if (!row) return null;
  return {
    ...row,
    settings: parseJson(row.settingsJson, {}),
    bases: parseJson(row.basesJson, {}),
  };
}

function returnWindow() {
  const row = db
    .prepare(`SELECT value FROM mlm_settings WHERE key = 'commission_rules'`)
    .get();
  const rules = parseJson(row?.value, {});
  return {
    days: Number(rules.returnPeriodDays ?? 7),
    afterReturn: rules.commissionAfterReturn !== false,
  };
}

function introductionOf(member) {
  const referral = db
    .prepare(`SELECT * FROM mlm_referrals WHERE memberId = ? LIMIT 1`)
    .get(member.memberId);

  if (referral) {
    return {
      type: referral.introductionType,
      sponsorId: referral.sponsorId,
      directSlot: referral.directSlot,
      source: "referral-row",
    };
  }

  if (!member.sponsorId) return null;

  const position = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM mlm_members
      WHERE sponsorId = ? AND id <= ?
    `)
    .get(member.sponsorId, member.id)?.count || 0;

  return {
    type: position <= MAX_DIRECT_INTRODUCTIONS ? "direct" : "spillover",
    sponsorId: member.sponsorId,
    directSlot: position <= MAX_DIRECT_INTRODUCTIONS ? position : null,
    source: "legacy-sponsor",
  };
}

function hasEarlierEligibleShopping(memberId, shoppingAt, orderId) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM mlm_eligibility_events e
      JOIN orders o ON o.id = e.orderId
      WHERE e.memberId = ?
        AND e.status = 'Confirmed'
        AND o.status = 'Delivered'
        AND IFNULL(o.paymentStatus, 'Pending') != 'Refunded'
        AND (
          o.createdAt < ?
          OR (o.createdAt = ? AND o.id < ?)
        )
      LIMIT 1
    `).get(memberId, shoppingAt, shoppingAt, orderId)
  );
}

function activeMember(memberId) {
  if (!memberId) return null;
  return db
    .prepare(`SELECT * FROM mlm_members WHERE memberId = ? AND status = 'active' LIMIT 1`)
    .get(memberId);
}

function commissionCandidates(order, snapshot, buyer) {
  const settings = snapshot.settings || {};
  const bases = snapshot.bases || {};
  const candidates = [];
  const purpose = (type) => ({
    type,
    source: SOURCE[type],
    percentage: Number(settings[type]?.percentage) || 0,
    calculationBase: settings[type]?.calculationBase || "product_total",
    maxLevels: Number(settings[type]?.maxLevels) || 1,
    chainLimit: Number(settings[type]?.chainLimit) || 1,
    effectiveFrom: settings[type]?.effectiveFrom || null,
  });

  const intro = introductionOf(buyer);

  const directRule = purpose("direct");
  if (
    settings.direct?.enabled &&
    directRule.percentage > 0 &&
    intro?.type === "direct"
  ) {
    const sponsor = activeMember(intro.sponsorId);
    if (sponsor && sponsor.memberId !== buyer.memberId) {
      candidates.push({ ...directRule, member: sponsor, reason: "direct-introduction" });
    }
  }

  const spillRule = purpose("spillover");
  if (
    settings.spillover?.enabled &&
    spillRule.percentage > 0 &&
    intro?.type === "spillover"
  ) {
    const placement = db
      .prepare(`
        SELECT * FROM mlm_placements
        WHERE memberId = ? AND status = 'Placed' LIMIT 1
      `)
      .get(buyer.memberId);
    const parent = activeMember(placement?.parentId);
    if (parent && parent.memberId !== buyer.memberId) {
      candidates.push({ ...spillRule, member: parent, reason: "spillover-placement" });
    }
  }

  const timeRule = purpose("timewise");
  if (
    settings.timewise?.enabled &&
    timeRule.percentage > 0 &&
    buyer.parentId &&
    bases[timeRule.calculationBase] > 0
  ) {
    let current = db
      .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
      .get(buyer.parentId);
    let level = 1;
    let added = 0;

    while (
      current &&
      level <= timeRule.maxLevels &&
      added < timeRule.chainLimit
    ) {
      if (
        current.memberId !== buyer.memberId &&
        hasEarlierEligibleShopping(
          current.memberId,
          snapshot.shoppingAt,
          order.id
        )
      ) {
        candidates.push({
          ...timeRule,
          member: current,
          reason: `timewise-level-${level}`,
          level,
        });
        added += 1;
      }

      current = current.parentId
        ? db.prepare(`SELECT * FROM mlm_members WHERE memberId = ?`).get(current.parentId)
        : null;
      level += 1;
    }
  }

  return candidates;
}

export function generateMlm3x3CommissionsForOrder(order) {
  if (!order || !order.id) return { created: 0, skipped: 0 };
  if (!["Delivered"].includes(order.status)) return { created: 0, skipped: 0 };
  if (order.paymentStatus === "Refunded") return { created: 0, skipped: 0 };

  const orderTotal =
    Number(String(order.totalAmount || "0").replace(/[^0-9.]/g, "")) || 0;
  if (orderTotal <= 0) return { created: 0, skipped: 0 };

  const snapshot = getOrderSnapshot(order.id);
  if (!snapshot || !snapshot.memberId) return { created: 0, skipped: 0 };

  const buyer = activeMember(snapshot.memberId);
  if (!buyer) return { created: 0, skipped: 0 };

  // One member can receive at most one 3×3 commission per order.
  const recipients = new Set();
  const candidates = commissionCandidates(order, snapshot, buyer);
  const window = returnWindow();
  const base = new Date(order.deliveredAt || order.createdAt || now());
  const payableAt = window.afterReturn
    ? new Date(base.getTime() + window.days * 24 * 60 * 60 * 1000).toISOString()
    : now();

  let created = 0;
  let skipped = 0;

  const insert = db.transaction(() => {
    for (const candidate of candidates) {
      if (recipients.has(candidate.member.memberId)) {
        skipped += 1;
        continue;
      }

      const baseAmount = round2(snapshot.bases[candidate.calculationBase]);
      if (baseAmount <= 0) {
        skipped += 1;
        continue;
      }

      const amount = round2((baseAmount * candidate.percentage) / 100);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      const ruleSnapshot = {
        earningType: candidate.type,
        label: TYPE_LABEL[candidate.type],
        percentage: candidate.percentage,
        calculationBase: candidate.calculationBase,
        baseAmount,
        maxLevels: candidate.maxLevels,
        chainLimit: candidate.chainLimit,
        effectiveFrom: candidate.effectiveFrom,
        reason: candidate.reason,
        shoppingAt: snapshot.shoppingAt,
        orderId: order.id,
        orderNumber: order.orderNumber,
      };

      const result = db.prepare(`
        INSERT OR IGNORE INTO mlm_commissions (
          memberId, orderId, type, description, amount, status, createdAt,
          payableAt, source, percentage, base_amount, calculation_base,
          rule_snapshot_json, eligible_at, settings_effective_from
        )
        VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate.member.memberId,
        order.id,
        candidate.type,
        `${TYPE_LABEL[candidate.type]} (${candidate.percentage}% of ₹${baseAmount.toFixed(2)}) on order ${order.orderNumber}`,
        amount,
        now(),
        payableAt,
        candidate.source,
        candidate.percentage,
        baseAmount,
        candidate.calculationBase,
        JSON.stringify(ruleSnapshot),
        order.deliveredAt || now(),
        candidate.effectiveFrom
      );

      if (Number(result.changes) !== 1) {
        skipped += 1;
        continue;
      }

      recipients.add(candidate.member.memberId);
      created += 1;

      db.prepare(`
        INSERT INTO mlm_3x3_commission_audit (
          at, actor, action, commissionId, orderId, memberId, source, amount, details
        )
        VALUES (?, 'system', 'created', ?, ?, ?, ?, ?, ?)
      `).run(
        now(),
        result.lastInsertRowid,
        order.id,
        candidate.member.memberId,
        candidate.source,
        amount,
        JSON.stringify(ruleSnapshot)
      );
    }
  });

  insert();

  return { created, skipped, payableAt };
}

export function voidMlm3x3CommissionsForOrder(orderId, reason, actor = "system") {
  const rows = db
    .prepare(`
      SELECT * FROM mlm_commissions
      WHERE orderId = ? AND source IS NOT NULL
        AND status IN ('Pending', 'Payable', 'Paid')
    `)
    .all(orderId);

  if (rows.length === 0) return { voided: 0 };

  const reverse = db.transaction(() => {
    let voided = 0;

    for (const row of rows) {
      if (row.status === "Payable") {
        db.prepare(`
          UPDATE mlm_wallets
          SET balance = MAX(0, balance - ?),
              totalEarned = MAX(0, totalEarned - ?),
              updatedAt = ?
          WHERE memberId = ?
        `).run(Number(row.amount) || 0, Number(row.amount) || 0, now(), row.memberId);
      }

      const nextStatus = row.status === "Paid" ? "Reversed" : "Void";
      db.prepare(`UPDATE mlm_commissions SET status = ? WHERE id = ?`).run(
        nextStatus,
        row.id
      );

      db.prepare(`
        INSERT INTO mlm_3x3_commission_audit (
          at, actor, action, commissionId, orderId, memberId, source, amount, details
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        now(),
        actor,
        nextStatus === "Void" ? "voided" : "reversed",
        row.id,
        orderId,
        row.memberId,
        row.source,
        row.amount,
        JSON.stringify({ reason, previousStatus: row.status })
      );

      voided += 1;
    }

    return voided;
  });

  return { voided: reverse() };
}

export function listMlm3x3Commissions({ type, status, from, to, limit = 200 } = {}) {
  const clauses = ["c.source IS NOT NULL"];
  const params = [];

  if (type && SOURCE[type]) {
    clauses.push("c.source = ?");
    params.push(SOURCE[type]);
  }
  if (status) {
    clauses.push("c.status = ?");
    params.push(String(status));
  }
  if (from) {
    clauses.push("c.createdAt >= ?");
    params.push(String(from));
  }
  if (to) {
    clauses.push("c.createdAt <= ?");
    params.push(String(to));
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

  return db.prepare(`
    SELECT
      c.*,
      m.name AS memberName,
      m.mobile AS memberMobile,
      o.orderNumber AS orderNumber,
      o.status AS orderStatus,
      o.paymentStatus AS orderPaymentStatus
    FROM mlm_commissions c
    LEFT JOIN mlm_members m ON m.memberId = c.memberId
    LEFT JOIN orders o ON o.id = c.orderId
    WHERE ${clauses.join(" AND ")}
    ORDER BY c.id DESC
    LIMIT ?
  `).all(...params, safeLimit);
}

export function getMlm3x3Summary() {
  const rows = db.prepare(`
    SELECT
      source,
      status,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS amount
    FROM mlm_commissions
    WHERE source IS NOT NULL
    GROUP BY source, status
  `).all();

  const summary = {};
  for (const type of TYPES) {
    summary[type] = {
      label: TYPE_LABEL[type],
      pending: { count: 0, amount: 0 },
      payable: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      void: { count: 0, amount: 0 },
      reversed: { count: 0, amount: 0 },
    };
  }

  for (const row of rows) {
    const type = Object.keys(SOURCE).find((key) => SOURCE[key] === row.source);
    if (!type) continue;
    const status = String(row.status || "").toLowerCase();
    if (summary[type][status]) {
      summary[type][status] = { count: row.count, amount: round2(row.amount) };
    }
  }

  return summary;
}

export function getMlmReferral(memberId) {
  return db
    .prepare(`SELECT * FROM mlm_referrals WHERE memberId = ? LIMIT 1`)
    .get(memberId);
}

// Count prior sponsored members (legacy or current) before inserting
// the new member. The first three introductions are direct; the
// fourth and later are still accepted, recorded as spillover
// introductions, and placed by the existing BFS engine.
export function classifyIntroduction(sponsorId) {
  const count = Number(
    db
      .prepare(`SELECT COUNT(*) AS count FROM mlm_members WHERE sponsorId = ?`)
      .get(sponsorId)?.count || 0
  );

  return count < MAX_DIRECT_INTRODUCTIONS
    ? { introductionType: "direct", directSlot: count + 1, priorCount: count }
    : { introductionType: "spillover", directSlot: null, priorCount: count };
}

export function recordMlmReferral({
  sponsorId,
  memberId,
  introductionType,
  directSlot,
  note,
}) {
  db.prepare(`
    INSERT INTO mlm_referrals (
      sponsorId, memberId, introductionType, directSlot, createdAt, note
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sponsorId,
    memberId,
    introductionType === "direct" ? "direct" : "spillover",
    introductionType === "direct" ? directSlot : null,
    now(),
    note || null
  );
}

export function getMlm3x3OrderSnapshot(orderId) {
  return getOrderSnapshot(orderId);
}

export { BASES, MAX_DIRECT_INTRODUCTIONS, SOURCE, TYPES };

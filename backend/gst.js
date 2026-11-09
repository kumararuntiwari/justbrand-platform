// =====================================================
// GST RATE MAPPINGS — category / subcategory / HSN
// =====================================================
// Single store for admin-verified GST classifications:
//   - scope "category"    → default for a whole category
//   - scope "subcategory" → narrower default inside a category
//   - scope "hsn"         → exact HSN/SAC code mapping (highest priority)
//
// A mapping is only USED for pricing when status = 'approved' AND its
// effective window covers today. Imported rows and edits stay 'pending'
// until an admin approves them, so nothing changes by itself.
//
// Every create / edit / approval / delete is appended to
// gst_mapping_history (append-only audit trail with before/after JSON).
// Rates are never guessed: only the statutory slabs below are accepted.

import db from "./db.js";

export const GST_RATE_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];
export const GST_TYPES = ["exclusive", "inclusive"];
export const GST_SCOPES = ["category", "subcategory", "hsn"];

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clean(value) {
  return String(value ?? "").trim();
}

export function isValidGstSlab(rate) {
  const value = Number(rate);
  return Number.isFinite(value) && GST_RATE_SLABS.some((slab) => Math.abs(value - slab) < 1e-9);
}

export function initGstMappings() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS gst_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'category',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      hsnCode TEXT NOT NULL DEFAULT '',
      gstRate REAL NOT NULL,
      gstType TEXT NOT NULL DEFAULT 'exclusive',
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL DEFAULT 'admin',
      effectiveFrom TEXT,
      effectiveTo TEXT,
      notes TEXT DEFAULT '',
      createdAt TEXT,
      updatedAt TEXT,
      approvedBy TEXT,
      approvedAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS gst_mappings_key
    ON gst_mappings (scope, category, subcategory, hsnCode)
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS gst_mapping_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mappingId INTEGER,
      action TEXT NOT NULL,
      scopeKey TEXT,
      beforeJson TEXT,
      afterJson TEXT,
      changedBy TEXT,
      reason TEXT,
      changedAt TEXT
    )
  `).run();

  // Backfill the legacy category_gst_rates rows once so the GST Manager
  // shows every rate that is already live. Legacy rows were saved by an
  // admin, so they are treated as approved (grandfathered).
  const legacyRows = db
    .prepare(`SELECT category, gstRate, hsnCode, updatedAt FROM category_gst_rates ORDER BY category`)
    .all();

  const insertMissing = db.prepare(`
    INSERT INTO gst_mappings
      (scope, category, subcategory, hsnCode, gstRate, gstType, status, source,
       effectiveFrom, effectiveTo, notes, createdAt, updatedAt, approvedBy, approvedAt)
    SELECT 'category', ?, '', ?, ?, 'exclusive', 'approved', 'legacy',
           ?, NULL, 'Backfilled from the earlier category GST setting',
           ?, ?, 'legacy-setting', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM gst_mappings WHERE scope = 'category' AND category = ? AND subcategory = '' AND hsnCode = ?
    )
  `);

  for (const row of legacyRows) {
    const stamp = row.updatedAt || now();
    insertMissing.run(
      row.category,
      clean(row.hsnCode),
      Number(row.gstRate) || 0,
      String(stamp).slice(0, 10),
      stamp,
      stamp,
      stamp,
      row.category,
      clean(row.hsnCode)
    );
  }
}

function mappingKey(mapping) {
  return `${mapping.scope}:${mapping.category || ""}:${mapping.subcategory || ""}:${mapping.hsnCode || ""}`;
}

function publicMapping(row) {
  if (!row) return null;
  const from = clean(row.effectiveFrom);
  const to = clean(row.effectiveTo);
  const date = today();
  const inWindow = (!from || from <= date) && (!to || to >= date);
  return {
    id: row.id,
    scope: row.scope,
    category: row.category || "",
    subcategory: row.subcategory || "",
    hsnCode: row.hsnCode || "",
    gstRate: Number(row.gstRate) || 0,
    gstType: row.gstType || "exclusive",
    status: row.status || "pending",
    source: row.source || "admin",
    effectiveFrom: from,
    effectiveTo: to,
    notes: row.notes || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedBy: row.approvedBy || "",
    approvedAt: row.approvedAt || "",
    active: row.status === "approved" && inWindow,
    key: mappingKey(row),
  };
}

export function listGstMappings() {
  return db
    .prepare(`SELECT * FROM gst_mappings ORDER BY category, subcategory, hsnCode, scope`)
    .all()
    .map(publicMapping);
}

export function getGstMapping(id) {
  return publicMapping(db.prepare(`SELECT * FROM gst_mappings WHERE id = ?`).get(Number(id)));
}

export function listGstHistory(limit = 200) {
  return db
    .prepare(`SELECT * FROM gst_mapping_history ORDER BY id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(1000, Number(limit) || 200)))
    .map((row) => ({
      id: row.id,
      mappingId: row.mappingId,
      action: row.action,
      scopeKey: row.scopeKey || "",
      before: row.beforeJson ? JSON.parse(row.beforeJson) : null,
      after: row.afterJson ? JSON.parse(row.afterJson) : null,
      changedBy: row.changedBy || "",
      reason: row.reason || "",
      changedAt: row.changedAt,
    }));
}

function writeHistory({ mappingId, action, mapping, before, after, changedBy, reason }) {
  db.prepare(`
    INSERT INTO gst_mapping_history
      (mappingId, action, scopeKey, beforeJson, afterJson, changedBy, reason, changedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mappingId || null,
    action,
    mapping ? mappingKey(mapping) : null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    clean(changedBy).slice(0, 80) || "admin",
    clean(reason).slice(0, 300) || null,
    now()
  );
}

function normalizeInput(input = {}) {
  const scope = clean(input.scope || "category").toLowerCase();
  const category = clean(input.category).slice(0, 100);
  const subcategory = clean(input.subcategory || input.subCategory).slice(0, 100);
  const hsnCode = clean(input.hsnCode).replace(/\s+/g, "").slice(0, 20);
  const gstType = clean(input.gstType || "exclusive").toLowerCase();

  return { scope, category, subcategory, hsnCode, gstType };
}

export function validateGstMapping(input = {}) {
  const normalized = normalizeInput(input);

  if (!GST_SCOPES.includes(normalized.scope)) {
    return { error: `Scope must be one of: ${GST_SCOPES.join(", ")}.` };
  }
  if (normalized.scope === "category" && !normalized.category) {
    return { error: "Category is required for a category-level GST mapping." };
  }
  if (normalized.scope === "subcategory") {
    if (!normalized.category) return { error: "Category is required for a subcategory mapping." };
    if (!normalized.subcategory) return { error: "Subcategory is required for a subcategory mapping." };
  }
  if (normalized.scope === "hsn") {
    if (!/^\d{4,8}$/.test(normalized.hsnCode)) {
      return { error: "HSN/SAC code must be 4 to 8 digits for an HSN mapping." };
    }
  } else if (normalized.hsnCode && !/^\d{4,8}$/.test(normalized.hsnCode)) {
    return { error: "HSN code must be 4 to 8 digits." };
  }

  const rateRaw = input.gstRate;
  if (rateRaw === undefined || rateRaw === null || rateRaw === "") {
    return { error: "GST rate is required." };
  }
  const gstRate = Number(rateRaw);
  if (!isValidGstSlab(gstRate)) {
    return {
      error: `GST rate must be one of the statutory slabs: ${GST_RATE_SLABS.join("%, ")}%.`,
    };
  }

  if (!GST_TYPES.includes(normalized.gstType)) {
    return { error: "GST type must be 'exclusive' or 'inclusive'." };
  }

  const effectiveFrom = clean(input.effectiveFrom) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
    return { error: "Effective date must be a valid YYYY-MM-DD date." };
  }

  const effectiveTo = clean(input.effectiveTo);
  if (effectiveTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || Number.isNaN(Date.parse(effectiveTo))) {
      return { error: "End date must be a valid YYYY-MM-DD date." };
    }
    if (effectiveTo < effectiveFrom) {
      return { error: "End date cannot be before the effective date." };
    }
  }

  return {
    value: {
      ...normalized,
      gstRate,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      notes: clean(input.notes).slice(0, 300),
    },
  };
}

// Approved + currently-effective mapping for the given product context.
// Priority is HSN → subcategory → category. Callers must not guess when
// this returns null.
export function findApprovedMapping({ category = "", subCategory = "", hsnCode = "" } = {}) {
  const cat = clean(category);
  const sub = clean(subCategory);
  const hsn = clean(hsnCode);
  const date = today();

  const active = db
    .prepare(`
      SELECT * FROM gst_mappings
      WHERE status = 'approved'
        AND (effectiveFrom IS NULL OR effectiveFrom = '' OR effectiveFrom <= ?)
        AND (effectiveTo IS NULL OR effectiveTo = '' OR effectiveTo >= ?)
    `)
    .all(date, date);

  // A mapping scoped to an HSN only covers that HSN. A category-wide
  // mapping (empty HSN) covers its category. When the product has no
  // HSN, the category/subcategory default still applies but the caller
  // flags "no_hsn" so an admin can complete the classification.
  const overlap = (mapping) => {
    if (!mapping.hsnCode) return true;
    if (!hsn) return true;
    return mapping.hsnCode === hsn;
  };

  if (hsn) {
    const byHsn = active.find((mapping) => mapping.scope === "hsn" && mapping.hsnCode === hsn);
    if (byHsn) return { mapping: publicMapping(byHsn), level: "hsn" };
  }

  if (cat) {
    if (sub) {
      const bySub = active.find(
        (mapping) =>
          mapping.scope === "subcategory" &&
          mapping.category === cat &&
          mapping.subcategory === sub
      );
      if (bySub) {
        if (overlap(bySub)) return { mapping: publicMapping(bySub), level: "subcategory" };
        return { mapping: null, level: "subcategory", hsnMismatch: true, blocked: publicMapping(bySub) };
      }
    }

    const byCat = active.find(
      (mapping) => mapping.scope === "category" && mapping.category === cat
    );
    if (byCat) {
      if (overlap(byCat)) return { mapping: publicMapping(byCat), level: "category" };
      return { mapping: null, level: "category", hsnMismatch: true, blocked: publicMapping(byCat) };
    }
  }

  return { mapping: null, level: "none" };
}

function syncLegacyCategoryRate(mapping) {
  if (!mapping) return;
  if (mapping.scope !== "category" || mapping.subcategory) return;

  // A future-dated (or expired) mapping must not leak into the legacy
  // category fallback either.
  if (mapping.status === "approved" && mapping.active) {
    db.prepare(`
      INSERT INTO category_gst_rates (category, gstRate, hsnCode, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        gstRate = excluded.gstRate,
        hsnCode = excluded.hsnCode,
        updatedAt = excluded.updatedAt
    `).run(mapping.category, mapping.gstRate, mapping.hsnCode || "", now());
  } else {
    // A pending edit must not keep the previous rate live.
    db.prepare(`DELETE FROM category_gst_rates WHERE category = ?`).run(mapping.category);
  }
}

export function saveGstMapping(input = {}, actor = "admin", { approve = false, reason = "", source = "admin" } = {}) {
  const checked = validateGstMapping(input);
  if (checked.error) return { ok: false, status: 400, message: checked.error };
  const value = checked.value;

  const existingRow = db
    .prepare(`
      SELECT * FROM gst_mappings
      WHERE scope = ? AND category = ? AND subcategory = ? AND hsnCode = ?
    `)
    .get(value.scope, value.category, value.subcategory, value.hsnCode);

  const before = existingRow ? publicMapping(existingRow) : null;
  const approved = Boolean(approve);
  const stamp = now();
  const status = approved ? "approved" : "pending";

  // One live mapping per category (or per category+subcategory): saving
  // a narrower/updated row replaces the previous category row, so an
  // old category-wide rate can never keep applying behind a new HSN
  // mapping.
  if (value.scope === "category" || value.scope === "subcategory") {
    const others = db
      .prepare(
        `SELECT * FROM gst_mappings
         WHERE scope = ? AND category = ? AND subcategory = ?`
      )
      .all(value.scope, value.category, value.subcategory)
      .filter((row) => !existingRow || row.id !== existingRow.id);

    for (const row of others) {
      const previous = publicMapping(row);
      db.prepare(`DELETE FROM gst_mappings WHERE id = ?`).run(row.id);
      writeHistory({
        mappingId: row.id,
        action: "replace",
        mapping: previous,
        before: previous,
        after: null,
        changedBy: actor,
        reason: `Replaced by a newer ${value.scope} mapping`,
      });
    }
  }

  if (existingRow) {
    db.prepare(`
      UPDATE gst_mappings
      SET gstRate = ?, gstType = ?, status = ?, source = ?, effectiveFrom = ?,
          effectiveTo = ?, notes = ?, updatedAt = ?,
          approvedBy = ?, approvedAt = ?
      WHERE id = ?
    `).run(
      value.gstRate,
      value.gstType,
      status,
      source,
      value.effectiveFrom,
      value.effectiveTo,
      value.notes,
      stamp,
      approved ? clean(actor).slice(0, 80) || "admin" : null,
      approved ? stamp : null,
      existingRow.id
    );
  } else {
    db.prepare(`
      INSERT INTO gst_mappings
        (scope, category, subcategory, hsnCode, gstRate, gstType, status, source,
         effectiveFrom, effectiveTo, notes, createdAt, updatedAt, approvedBy, approvedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.scope,
      value.category,
      value.subcategory,
      value.hsnCode,
      value.gstRate,
      value.gstType,
      status,
      source,
      value.effectiveFrom,
      value.effectiveTo,
      value.notes,
      stamp,
      stamp,
      approved ? clean(actor).slice(0, 80) || "admin" : null,
      approved ? stamp : null
    );
  }

  const after = getGstMapping(
    existingRow
      ? existingRow.id
      : db.prepare(`SELECT id FROM gst_mappings WHERE scope = ? AND category = ? AND subcategory = ? AND hsnCode = ?`)
          .get(value.scope, value.category, value.subcategory, value.hsnCode)?.id
  );

  writeHistory({
    mappingId: after?.id,
    action: existingRow ? (approved ? "update+approve" : "update") : approved ? "create+approve" : "create",
    mapping: after,
    before,
    after,
    changedBy: actor,
    reason,
  });

  syncLegacyCategoryRate(after);

  return {
    ok: true,
    mapping: after,
    applied: Boolean(after?.active),
    message: approved
      ? `GST ${after.gstRate}% saved and approved for ${after.scope} mapping “${after.category || after.hsnCode}”.`
      : `GST ${after.gstRate}% saved as a draft for ${after.scope} mapping “${after.category || after.hsnCode}” — approve it to apply.`,
  };
}

export function approveGstMapping(id, actor = "admin", reason = "") {
  const row = db.prepare(`SELECT * FROM gst_mappings WHERE id = ?`).get(Number(id));
  if (!row) return { ok: false, status: 404, message: "GST mapping not found." };

  const before = publicMapping(row);
  const stamp = now();
  db.prepare(`
    UPDATE gst_mappings
    SET status = 'approved', approvedBy = ?, approvedAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(clean(actor).slice(0, 80) || "admin", stamp, stamp, row.id);

  const after = getGstMapping(row.id);
  writeHistory({
    mappingId: row.id,
    action: "approve",
    mapping: after,
    before,
    after,
    changedBy: actor,
    reason,
  });
  syncLegacyCategoryRate(after);

  return { ok: true, mapping: after, message: `GST ${after.gstRate}% mapping approved and applied.` };
}

export function deleteGstMapping(id, actor = "admin", reason = "") {
  const row = db.prepare(`SELECT * FROM gst_mappings WHERE id = ?`).get(Number(id));
  if (!row) return { ok: false, status: 404, message: "GST mapping not found." };

  const before = publicMapping(row);
  db.prepare(`DELETE FROM gst_mappings WHERE id = ?`).run(row.id);

  if (row.scope === "category") {
    db.prepare(`DELETE FROM category_gst_rates WHERE category = ?`).run(row.category);
  }

  writeHistory({
    mappingId: row.id,
    action: "delete",
    mapping: before,
    before,
    after: null,
    changedBy: actor,
    reason,
  });

  return { ok: true, message: "GST mapping removed. Products it covered are flagged for review." };
}

export function getGstMappingSummary() {
  const mappings = listGstMappings();
  const byStatus = { approved: 0, pending: 0 };
  let expired = 0;
  let hsn = 0;
  let subcategory = 0;
  let category = 0;

  for (const mapping of mappings) {
    byStatus[mapping.status] = (byStatus[mapping.status] || 0) + 1;
    if (mapping.status === "approved" && !mapping.active) expired++;
    if (mapping.scope === "hsn") hsn++;
    else if (mapping.scope === "subcategory") subcategory++;
    else category++;
  }

  return {
    total: mappings.length,
    approved: byStatus.approved || 0,
    pending: byStatus.pending || 0,
    expired,
    category,
    subcategory,
    hsn,
  };
}

// ------------------------------------------
// CSV / XLSX import staging
// ------------------------------------------
// Rows arrive already parsed (the seller import parser handles CSV and
// XLSX without extra dependencies). Imported rows are ALWAYS drafts —
// an admin must approve each mapping before it is used.
const IMPORT_HEADERS = {
  scope: ["scope", "type", "level"],
  category: ["category", "categoryname"],
  subcategory: ["subcategory", "subcategoryname", "sub category"],
  hsn: ["hsn", "hsncode", "hsn/sac", "hsnsac", "sac"],
  rate: ["gstrate", "gst", "rate", "taxrate", "gst%"],
  gsttype: ["gsttype", "pricetype", "priceincludesgst"],
  effectivefrom: ["effectivefrom", "from", "effectivedate", "startdate"],
  effectiveto: ["effectiveto", "to", "enddate"],
  notes: ["notes", "note", "remarks"],
};

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/[\s_\-()%]/g, "");
}

function headerPositions(headerRow) {
  const positions = {};
  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    for (const [field, aliases] of Object.entries(IMPORT_HEADERS)) {
      if (aliases.some((alias) => normalizeHeader(alias) === key)) {
        positions[field] = index;
      }
    }
  });
  return positions;
}

export function stageGstImport(rows, actor = "admin") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, status: 400, message: "The uploaded file is empty." };
  }

  const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => clean(cell)));
  if (headerIndex < 0) return { ok: false, status: 400, message: "No header row found in the file." };

  const positions = headerPositions(rows[headerIndex]);
  if (positions.category === undefined && positions.hsn === undefined) {
    return {
      ok: false,
      status: 400,
      message: "The file needs at least a Category or HSN column (plus GST Rate).",
    };
  }
  if (positions.rate === undefined) {
    return { ok: false, status: 400, message: "The file needs a GST Rate column." };
  }

  const imported = [];
  const errors = [];

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!Array.isArray(row) || row.every((cell) => !clean(cell))) continue;
    if (clean(row[0]).startsWith("#")) continue;

    const pick = (field) => (positions[field] === undefined ? "" : clean(row[positions[field]]));
    const hsnCode = pick("hsn").replace(/\s+/g, "");
    const category = pick("category");
    const subcategory = pick("subcategory");
    const declaredScope = pick("scope").toLowerCase();

    let scope = declaredScope;
    if (!GST_SCOPES.includes(scope)) {
      scope = hsnCode && !category ? "hsn" : subcategory ? "subcategory" : "category";
    }
    if (scope === "hsn" && hsnCode) scope = "hsn";

    const typeRaw = pick("gsttype").toLowerCase();
    const gstType =
      typeRaw.includes("incl") || typeRaw === "true" ? "inclusive" : "exclusive";

    const result = saveGstMapping(
      {
        scope,
        category,
        subcategory,
        hsnCode,
        gstRate: pick("rate"),
        gstType,
        effectiveFrom: pick("effectivefrom"),
        effectiveTo: pick("effectiveto"),
        notes: pick("notes"),
      },
      actor,
      { approve: false, reason: "CSV/XLSX import (pending admin approval)", source: "import" }
    );

    if (!result.ok) {
      errors.push({ row: index + 1, message: result.message });
    } else {
      imported.push(result.mapping);
    }
  }

  return {
    ok: true,
    importedCount: imported.length,
    errorCount: errors.length,
    mappings: imported,
    errors: errors.slice(0, 50),
    message: `${imported.length} GST mapping row(s) imported as drafts — approve them to apply.`,
  };
}

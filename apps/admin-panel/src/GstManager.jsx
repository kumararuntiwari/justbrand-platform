// =====================================================
// ADMIN — GST MANAGER
// =====================================================
// One screen for the whole GST classification workflow:
//   • category / subcategory / HSN rate mappings
//   • draft → approved gate (nothing applies without approval)
//   • effective dates + append-only change history
//   • CSV / XLSX import (staged as drafts)
//   • CGST+SGST vs IGST preview
//   • product GST review report (Missing / Incorrect / Verified)
//
// Server is the only authority: every rate is validated against the
// statutory slabs there, and approved mappings are what pricing uses.
// Rates are never guessed in this UI.

import { useEffect, useMemo, useState } from "react";
import { API } from "./apiConfig";

const EMPTY_DRAFT = {
  id: null,
  scope: "category",
  category: "",
  subcategory: "",
  hsnCode: "",
  gstRate: "18",
  gstType: "exclusive",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  notes: "",
};

const labelStyle = {
  display: "grid",
  gap: "6px",
  fontSize: "12.5px",
  fontWeight: 600,
  color: "#4a4a52",
};

const inputStyle = {
  padding: "9px 11px",
  borderRadius: "9px",
  border: "1px solid #e2e2e8",
  fontSize: "13px",
  background: "#fff",
  color: "#1f1f24",
  width: "100%",
  boxSizing: "border-box",
};

const hintStyle = { margin: "6px 0 0", fontSize: "12px", color: "#6b6b74", lineHeight: 1.5 };
const cardStyle = { background: "#fff", border: "1px solid #eeeef2", borderRadius: "14px", padding: "18px" };
const thStyle = { padding: "9px 10px", fontSize: "11.5px", fontWeight: 700, color: "#6b6b74", textAlign: "left", whiteSpace: "nowrap" };
const tdStyle = { padding: "9px 10px", fontSize: "12.5px", verticalAlign: "top" };
const primaryBtn = {
  padding: "9px 16px",
  borderRadius: "9px",
  border: "none",
  background: "linear-gradient(90deg,#ff7a00,#e91e63)",
  color: "#fff",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};
const ghostBtn = {
  padding: "8px 13px",
  borderRadius: "9px",
  border: "1px solid #e2e2e8",
  background: "#fff",
  color: "#33333a",
  fontWeight: 600,
  fontSize: "12.5px",
  cursor: "pointer",
};

function statusTag(status) {
  if (status === "approved") return "sec-tag sec-tag-good";
  if (status === "pending") return "sec-tag sec-tag-warn";
  return "sec-tag";
}

function reviewTag(statusLabel) {
  if (statusLabel === "Verified") return "sec-tag sec-tag-good";
  if (statusLabel === "Incorrect") return "sec-tag sec-tag-bad";
  return "sec-tag sec-tag-warn";
}

function formatDate(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—";
}

export default function GstManager({ token, onMessage }) {
  const [data, setData] = useState({
    mappings: [],
    summary: {},
    history: [],
    categories: [],
    subcategories: [],
    validGstSlabs: [],
    gstTypes: ["exclusive", "inclusive"],
  });
  const [report, setReport] = useState({ items: [], pendingCount: 0, verifiedCount: 0, missingCount: 0, incorrectCount: 0 });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [settings, setSettings] = useState({ gst: { originState: "", priceIncludesGst: false }, originStates: [] });
  const [split, setSplit] = useState({ rate: "18", destinationState: "", taxableValue: "1000", result: null });
  const [reviewFilter, setReviewFilter] = useState("All");
  const [fixes, setFixes] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(true);

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) throw new Error(payload?.message || `Request failed (HTTP ${response.status}).`);
    return payload;
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [list, review, charges] = await Promise.all([
        request("/api/admin/gst/mappings"),
        request("/api/admin/gst/review").catch(() => null),
        request("/api/admin/charges/settings").catch(() => null),
      ]);
      setData(list);
      if (review) setReport(review);
      if (charges) setSettings({ gst: charges.gst || {}, originStates: charges.originStates || [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subcategoryOptions = useMemo(() => {
    if (!draft.category) return data.subcategories || [];
    return (data.subcategories || []).filter((row) => !row.parent || row.parent === draft.category);
  }, [data.subcategories, draft.category]);

  function notify(message) {
    if (onMessage) onMessage(message);
  }

  async function saveMapping(approve) {
    setBusy(approve ? "save-approve" : "save-draft");
    setError("");
    try {
      const body = {
        scope: draft.scope,
        category: draft.scope === "hsn" ? draft.category : draft.category,
        subcategory: draft.scope === "subcategory" ? draft.subcategory : "",
        hsnCode: draft.hsnCode,
        gstRate: Number(draft.gstRate),
        gstType: draft.gstType,
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo,
        notes: draft.notes,
        approve,
      };
      const path = draft.id ? `/api/admin/gst/mappings/${draft.id}` : "/api/admin/gst/mappings";
      const result = await request(path, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(body) });
      notify(result.message);
      setDraft({ ...EMPTY_DRAFT, scope: draft.scope });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function approveMapping(mapping) {
    setBusy(`approve-${mapping.id}`);
    setError("");
    try {
      const result = await request(`/api/admin/gst/mappings/${mapping.id}/approve`, { method: "POST", body: "{}" });
      notify(result.message);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function removeMapping(mapping) {
    if (!window.confirm(`Remove the GST ${mapping.gstRate}% mapping for ${mapping.category || mapping.hsnCode}?`)) return;
    setBusy(`delete-${mapping.id}`);
    setError("");
    try {
      const result = await request(`/api/admin/gst/mappings/${mapping.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: "Removed from GST Manager" }),
      });
      notify(result.message);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function editMapping(mapping) {
    setDraft({
      id: mapping.id,
      scope: mapping.scope,
      category: mapping.category || "",
      subcategory: mapping.subcategory || "",
      hsnCode: mapping.hsnCode || "",
      gstRate: String(mapping.gstRate),
      gstType: mapping.gstType || "exclusive",
      effectiveFrom: mapping.effectiveFrom || new Date().toISOString().slice(0, 10),
      effectiveTo: mapping.effectiveTo || "",
      notes: mapping.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy("import");
    setError("");
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch(`${API}/api/admin/gst/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${token}`,
          "x-file-name": file.name,
        },
        body: buffer,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || `Import failed (HTTP ${response.status}).`);
      setImportResult(result);
      notify(result.message);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function downloadSample() {
    const csv = [
      "scope,category,subcategory,hsn,gstRate,gstType,effectiveFrom,effectiveTo,notes",
      "category,Electronics,,,18,exclusive,2026-01-01,,Electronics default",
      "subcategory,Fashion,Shirts,,12,exclusive,2026-01-01,,Readymade garments",
      "hsn,,,8517,18,exclusive,2026-01-01,,Mobile phones",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "justbrand-gst-rates-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runSplitPreview() {
    setBusy("split");
    setError("");
    try {
      const params = new URLSearchParams({
        rate: split.rate,
        destinationState: split.destinationState,
        taxableValue: split.taxableValue,
      });
      const result = await request(`/api/admin/gst/preview?${params.toString()}`);
      setSplit({ ...split, result: result.preview });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function fixValue(item) {
    return (
      fixes[item.id] || {
        hsnCode: item.effectiveHsn || item.hsnCode || "",
        gstRate: String(item.gstRate || ""),
        gstType: item.gstType || "exclusive",
      }
    );
  }

  async function saveProductFix(item) {
    const fix = fixValue(item);
    setBusy(`fix-${item.id}`);
    setError("");
    try {
      const result = await request(`/api/admin/products/${item.id}/tax`, {
        method: "PUT",
        body: JSON.stringify({
          hsnCode: fix.hsnCode,
          gstRate: Number(fix.gstRate),
          gstType: fix.gstType,
        }),
      });
      notify(result.message);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const filteredReview = useMemo(() => {
    const items = report.items || [];
    return reviewFilter === "All" ? items : items.filter((item) => item.statusLabel === reviewFilter);
  }, [report.items, reviewFilter]);

  const summary = data.summary || {};

  if (loading && data.mappings.length === 0) {
    return (
      <section style={{ ...cardStyle, marginTop: "12px" }}>
        <p style={{ margin: 0, color: "#6b6b74" }}>Loading GST mappings…</p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: "16px", marginTop: "12px" }}>
      {error ? (
        <div style={{ padding: "10px 14px", borderRadius: "10px", background: "#fff0f0", color: "#c00", fontSize: "13px" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "10px" }}>
        {[
          ["Total mappings", summary.total || 0],
          ["Approved", summary.approved || 0],
          ["Pending approval", summary.pending || 0],
          ["Expired", summary.expired || 0],
          ["Products pending review", report.pendingCount || 0],
        ].map(([label, value]) => (
          <div key={label} style={{ ...cardStyle, padding: "14px 16px" }}>
            <div style={{ fontSize: "11.5px", color: "#6b6b74", fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: "#1f1f24", marginTop: "4px" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ---------- mapping editor ---------- */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>{draft.id ? "Edit GST mapping" : "Add GST mapping"}</h3>
        <p style={{ ...hintStyle, marginTop: 0 }}>
          Only approved and currently-effective mappings are used for pricing. Saving a draft changes nothing until you
          approve it. Rates are limited to the statutory slabs — no estimates.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "12px", marginTop: "10px" }}>
          <label style={labelStyle}>
            Mapping level
            <select style={inputStyle} value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })}>
              <option value="category">Category default</option>
              <option value="subcategory">Category + Subcategory</option>
              <option value="hsn">HSN / SAC code</option>
            </select>
          </label>

          <label style={labelStyle}>
            Category {draft.scope === "hsn" ? "(optional)" : "*"}
            <input
              style={inputStyle}
              list="jb-gst-categories"
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              placeholder="e.g. Electronics"
            />
            <datalist id="jb-gst-categories">
              {(data.categories || []).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>

          <label style={labelStyle}>
            Subcategory {draft.scope === "subcategory" ? "*" : "(optional)"}
            <input
              style={inputStyle}
              list="jb-gst-subcategories"
              value={draft.subcategory}
              onChange={(event) => setDraft({ ...draft, subcategory: event.target.value })}
              placeholder="e.g. Shirts"
            />
            <datalist id="jb-gst-subcategories">
              {subcategoryOptions.map((row) => (
                <option key={`${row.parent}-${row.name}`} value={row.name} />
              ))}
            </datalist>
          </label>

          <label style={labelStyle}>
            HSN / SAC {draft.scope === "hsn" ? "*" : "(optional)"}
            <input
              style={inputStyle}
              value={draft.hsnCode}
              onChange={(event) => setDraft({ ...draft, hsnCode: event.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
              placeholder="4–8 digits"
            />
          </label>

          <label style={labelStyle}>
            GST rate
            <select style={inputStyle} value={draft.gstRate} onChange={(event) => setDraft({ ...draft, gstRate: event.target.value })}>
              {(data.validGstSlabs || []).map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Price GST type
            <select style={inputStyle} value={draft.gstType} onChange={(event) => setDraft({ ...draft, gstType: event.target.value })}>
              <option value="exclusive">Exclusive (add GST)</option>
              <option value="inclusive">Inclusive (GST inside price)</option>
            </select>
          </label>

          <label style={labelStyle}>
            Effective from
            <input type="date" style={inputStyle} value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} />
          </label>

          <label style={labelStyle}>
            Effective to (optional)
            <input type="date" style={inputStyle} value={draft.effectiveTo} onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })} />
          </label>

          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
            Notes / source of the rate
            <input
              style={inputStyle}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="e.g. GST rate schedule entry, HSN 8517 → 18%"
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" }}>
          <button type="button" style={ghostBtn} disabled={busy === "save-draft"} onClick={() => saveMapping(false)}>
            {busy === "save-draft" ? "Saving…" : "💾 Save draft"}
          </button>
          <button type="button" style={primaryBtn} disabled={busy === "save-approve"} onClick={() => saveMapping(true)}>
            {busy === "save-approve" ? "Saving…" : "✓ Save & approve"}
          </button>
          <button type="button" style={ghostBtn} onClick={() => setDraft({ ...EMPTY_DRAFT, scope: draft.scope })}>
            Reset
          </button>
        </div>
        <p style={hintStyle}>
          Approved mapping बदलने पर products तुरंत reprice होते हैं, लेकिन पुराने orders अपना GST snapshot बनाए रखते हैं।
        </p>
      </div>

      {/* ---------- mappings table ---------- */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>Category &amp; HSN rate mappings</h3>
          <span style={{ fontSize: "12px", color: "#6b6b74" }}>{data.mappings.length} total</span>
        </div>

        {data.mappings.length === 0 ? (
          <p style={{ ...hintStyle, marginTop: "10px" }}>No GST mappings yet. Add one above or import a CSV/XLSX rate sheet.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "10px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafc" }}>
                  <th style={thStyle}>Level</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Subcategory</th>
                  <th style={thStyle}>HSN</th>
                  <th style={thStyle}>Rate</th>
                  <th style={thStyle}>Effective</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.mappings.map((mapping) => (
                  <tr key={mapping.id} style={{ borderTop: "1px solid #f0f0f3" }}>
                    <td style={tdStyle}>{mapping.scope}</td>
                    <td style={tdStyle}>{mapping.category || "—"}</td>
                    <td style={tdStyle}>{mapping.subcategory || "—"}</td>
                    <td style={tdStyle}>{mapping.hsnCode || "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{mapping.gstRate}%</td>
                    <td style={tdStyle}>
                      {mapping.effectiveFrom || "—"}
                      {mapping.effectiveTo ? ` → ${mapping.effectiveTo}` : ""}
                    </td>
                    <td style={tdStyle}>{mapping.source}</td>
                    <td style={tdStyle}>
                      <span className={statusTag(mapping.status)}>{mapping.status}</span>
                      {mapping.status === "approved" && !mapping.active ? (
                        <span style={{ marginLeft: "6px", fontSize: "11px", color: "#b45309" }}>not effective today</span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {mapping.status !== "approved" ? (
                          <button
                            type="button"
                            style={{ ...ghostBtn, padding: "5px 9px", fontSize: "11.5px" }}
                            disabled={busy === `approve-${mapping.id}`}
                            onClick={() => approveMapping(mapping)}
                          >
                            Approve
                          </button>
                        ) : null}
                        <button type="button" style={{ ...ghostBtn, padding: "5px 9px", fontSize: "11.5px" }} onClick={() => editMapping(mapping)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          style={{ ...ghostBtn, padding: "5px 9px", fontSize: "11.5px", color: "#b91c1c" }}
                          disabled={busy === `delete-${mapping.id}`}
                          onClick={() => removeMapping(mapping)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- import + split preview ---------- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "16px" }}>
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>CSV / Excel import</h3>
          <p style={{ ...hintStyle, marginTop: 0 }}>
            Upload a rate sheet (.csv / .xlsx). Every row is imported as a <b>pending draft</b> — approve the rows you
            trust. Columns: scope, category, subcategory, hsn, gstRate, gstType, effectiveFrom, effectiveTo, notes.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
            <label style={{ ...primaryBtn, display: "inline-block" }}>
              {busy === "import" ? "Importing…" : "📥 Choose file"}
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={importFile}
                disabled={busy === "import"}
              />
            </label>
            <button type="button" style={ghostBtn} onClick={downloadSample}>
              Download sample CSV
            </button>
          </div>

          {importResult ? (
            <div style={{ marginTop: "12px", fontSize: "12.5px", color: "#33333a" }}>
              <div>
                ✅ {importResult.importedCount} draft(s) imported
                {importResult.errorCount ? ` · ${importResult.errorCount} row(s) rejected` : ""}
              </div>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <ul style={{ margin: "8px 0 0", paddingLeft: "18px", color: "#b91c1c" }}>
                  {importResult.errors.slice(0, 6).map((row) => (
                    <li key={row.row}>
                      Row {row.row}: {row.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>CGST + SGST / IGST preview</h3>
          <p style={{ ...hintStyle, marginTop: 0 }}>
            Origin: <b>{settings.gst.originState || "not configured"}</b> (Charges &amp; Tax). Same state → CGST + SGST,
            different state → IGST. Unknown origin never guesses a split.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: "10px", marginTop: "8px" }}>
            <label style={labelStyle}>
              GST rate
              <select style={inputStyle} value={split.rate} onChange={(event) => setSplit({ ...split, rate: event.target.value })}>
                {(data.validGstSlabs || []).map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Taxable value ₹
              <input style={inputStyle} type="number" min="0" value={split.taxableValue} onChange={(event) => setSplit({ ...split, taxableValue: event.target.value })} />
            </label>
            <label style={labelStyle}>
              Destination state
              <select style={inputStyle} value={split.destinationState} onChange={(event) => setSplit({ ...split, destinationState: event.target.value })}>
                <option value="">Select state</option>
                {(settings.originStates || []).map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: "10px" }}>
            <button type="button" style={ghostBtn} disabled={busy === "split"} onClick={runSplitPreview}>
              🔍 Calculate split
            </button>
          </div>

          {split.result ? (
            <div style={{ marginTop: "10px", fontSize: "12.5px", color: "#33333a", display: "grid", gap: "4px" }}>
              <div>Taxable: ₹{Number(split.result.taxableValue).toFixed(2)}</div>
              <div>GST: ₹{Number(split.result.gstAmount).toFixed(2)}</div>
              {split.result.splitMode === "intra" ? (
                <>
                  <div>CGST: ₹{Number(split.result.cgst).toFixed(2)}</div>
                  <div>SGST: ₹{Number(split.result.sgst).toFixed(2)}</div>
                </>
              ) : split.result.splitMode === "inter" ? (
                <div>IGST: ₹{Number(split.result.igst).toFixed(2)}</div>
              ) : (
                <div style={{ color: "#b45309" }}>
                  Split not possible ({split.result.splitMode.replaceAll("_", " ")}) — only the GST total is shown.
                </div>
              )}
              <div style={{ fontWeight: 700 }}>Total: ₹{Number(split.result.total).toFixed(2)}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- GST review report ---------- */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "15px" }}>GST review report</h3>
            <p style={{ ...hintStyle, marginTop: 2 }}>
              {report.pendingCount || 0} product(s) pending · {report.verifiedCount || 0} verified ·{" "}
              {report.missingCount || 0} missing · {report.incorrectCount || 0} incorrect
            </p>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {["All", "Missing", "Incorrect", "Verified"].map((filter) => (
              <button
                key={filter}
                type="button"
                className={reviewFilter === filter ? "sec-tag sec-tag-warn" : "sec-tag"}
                style={{ border: "1px solid #e7e7ec", padding: "6px 10px", fontSize: "12px", cursor: "pointer" }}
                onClick={() => setReviewFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: "10px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafc" }}>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>HSN</th>
                <th style={thStyle}>Current GST</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Admin fix</th>
              </tr>
            </thead>
            <tbody>
              {filteredReview.map((item) => {
                const fix = fixValue(item);
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #f0f0f3" }}>
                    <td style={tdStyle}>{item.category || "—"}</td>
                    <td style={tdStyle}>
                      {item.name}
                      {item.subCategory ? <div style={{ fontSize: "11px", color: "#6b6b74" }}>{item.subCategory}</div> : null}
                    </td>
                    <td style={tdStyle}>{item.sku || "—"}</td>
                    <td style={tdStyle}>
                      {item.effectiveHsn || item.hsnCode || "—"}
                      {item.hsnCode && item.effectiveHsn && item.hsnCode !== item.effectiveHsn ? (
                        <div style={{ fontSize: "11px", color: "#b45309" }}>product: {item.hsnCode}</div>
                      ) : null}
                    </td>
                    <td style={tdStyle}>{item.gstRate}%</td>
                    <td style={tdStyle}>{item.source}</td>
                    <td style={tdStyle}>
                      <span className={reviewTag(item.statusLabel)}>{item.statusLabel}</span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          style={{ ...inputStyle, width: "88px", padding: "6px 8px" }}
                          placeholder="HSN"
                          value={fix.hsnCode}
                          onChange={(event) =>
                            setFixes({
                              ...fixes,
                              [item.id]: { ...fix, hsnCode: event.target.value.replace(/[^0-9]/g, "").slice(0, 8) },
                            })
                          }
                        />
                        <select
                          style={{ ...inputStyle, width: "78px", padding: "6px 8px" }}
                          value={fix.gstRate}
                          onChange={(event) => setFixes({ ...fixes, [item.id]: { ...fix, gstRate: event.target.value } })}
                        >
                          <option value="">Rate</option>
                          {(data.validGstSlabs || []).map((rate) => (
                            <option key={rate} value={rate}>
                              {rate}%
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          style={{ ...ghostBtn, padding: "6px 9px", fontSize: "11.5px" }}
                          disabled={busy === `fix-${item.id}`}
                          onClick={() => saveProductFix(item)}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredReview.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, color: "#6b6b74" }}>
                    No products in this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p style={hintStyle}>
          Product-level rate यहाँ से set करने पर वह explicitly admin-approved (source: product) होता है और mapping को
          override कर सकता है। Seller केवल suggestion देख सकता है।
        </p>
      </div>

      {/* ---------- history ---------- */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>GST change history</h3>
        <p style={{ ...hintStyle, marginTop: 0 }}>Append-only: हर create / edit / approve / remove दर्ज रहता है।</p>

        {data.history.length === 0 ? (
          <p style={{ ...hintStyle, marginTop: "10px" }}>No GST changes recorded yet.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "10px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafc" }}>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>Action</th>
                  <th style={thStyle}>Mapping</th>
                  <th style={thStyle}>Before</th>
                  <th style={thStyle}>After</th>
                  <th style={thStyle}>By</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice(0, 40).map((entry) => (
                  <tr key={entry.id} style={{ borderTop: "1px solid #f0f0f3" }}>
                    <td style={tdStyle}>{formatDate(entry.changedAt)}</td>
                    <td style={tdStyle}>{entry.action}</td>
                    <td style={tdStyle}>{entry.scopeKey || "—"}</td>
                    <td style={tdStyle}>{entry.before ? `${entry.before.gstRate}% · ${entry.before.status}` : "—"}</td>
                    <td style={tdStyle}>{entry.after ? `${entry.after.gstRate}% · ${entry.after.status}` : "—"}</td>
                    <td style={tdStyle}>{entry.changedBy || "—"}</td>
                    <td style={tdStyle}>{entry.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

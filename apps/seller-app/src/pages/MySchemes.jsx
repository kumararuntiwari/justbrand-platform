import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../index.css";

// =====================================================
// SELLER — MY SCHEMES
// =====================================================
// Seller-created discount schemes with an Admin approval gate:
//   Draft → (submit) → Pending Approval → Approved | Rejected
//   Approved + end date passed → shown as Expired
// The seller can create/edit/submit ONLY Draft or Rejected schemes
// and can NEVER approve their own scheme — approval exists solely on
// the admin side (server-side ownership checks included).
//
// Backend reality: the scheme endpoints/table live in this repo's
// backend source only. On a backend without them (e.g. production
// today) this page falls back to a clearly-labelled LOCAL PREVIEW
// store (this device's localStorage) so the flow stays inspectable —
// nothing is ever claimed to be saved server-side in that mode.
//
// Discount math is DISPLAY ONLY: it never mutates the existing
// pricing pipeline (platform fee, delivery, GST, Family commission
// stay exactly as configured). Final price is floored at the
// seller's own base price so a scheme can never sell below it.

import { API_URL } from "../api.js";
const LOCAL_KEY = "jb_seller_schemes_local_v1";

const STATUS_STYLES = {
  Draft: { bg: "#eef1f6", fg: "#4b5563" },
  "Pending Approval": { bg: "#fff7ed", fg: "#9a3412" },
  Approved: { bg: "#ecfdf3", fg: "#047857" },
  Rejected: { bg: "#fef2f2", fg: "#b91c1c" },
  Expired: { bg: "#f3f4f6", fg: "#6b7280" },
};

const EMPTY_FORM = {
  name: "",
  description: "",
  discountType: "percent",
  discountValue: "",
  startDate: "",
  endDate: "",
  productIds: [],
};

function readLocalSchemes() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocalSchemes(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function parseMoney(value) {
  return Number(String(value ?? "").replace(/[^0-9.]/g, "")) || 0;
}

function money(value) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.Draft;

  return (
    <span
      style={{
        background: style.bg,
        color: style.fg,
        borderRadius: "20px",
        padding: "3px 10px",
        fontSize: "12px",
        fontWeight: "700",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function MySchemes({ onBack }) {
  const token = localStorage.getItem("justbrand_seller_token") || "";

  const [mode, setMode] = useState("loading"); // loading | live | local
  const [schemes, setSchemes] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null); // { tone, message }
  const [form, setForm] = useState(null); // null = list view, else draft
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/sellers/schemes`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data?.success && Array.isArray(data.schemes)) {
        setMode("live");
        setSchemes(data.schemes);
      } else {
        // Scheme endpoints missing on this backend (404) or session
        // unusable — degrade to the labelled local preview store.
        setMode("local");
        setSchemes(readLocalSchemes());
      }
    } catch {
      setMode("local");
      setSchemes(readLocalSchemes());
    }

    // Seller's own products (endpoint exists on every current backend)
    // — needed for product selection + the pricing preview.
    try {
      const response = await fetch(`${API_URL}/api/sellers/products`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);
      const list = data?.success && Array.isArray(data.products) ? data.products : [];
      setProducts(list);
    } catch {
      setProducts([]);
    }

    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const startCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setNotice(null);
  };

  const startEdit = (scheme) => {
    setForm({
      name: scheme.name || "",
      description: scheme.description || "",
      discountType: scheme.discountType === "flat" ? "flat" : "percent",
      discountValue: String(scheme.discountValue ?? ""),
      startDate: scheme.startDate || "",
      endDate: scheme.endDate || "",
      productIds: Array.isArray(scheme.productIds) ? scheme.productIds : [],
    });
    setEditingId(scheme.id);
    setNotice(null);
  };

  const cancelForm = () => {
    setForm(null);
    setEditingId(null);
    setNotice(null);
  };

  const validate = (requireSubmitFields) => {
    if (!form.name.trim()) return "Scheme name is required.";

    const value = Number(form.discountValue);
    if (!Number.isFinite(value) || value < 0) {
      return "Discount value must be zero or more.";
    }
    if (form.discountType === "percent" && value > 100) {
      return "A percent discount cannot exceed 100%.";
    }

    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return "End date must be on or after the start date.";
    }

    if (requireSubmitFields) {
      if (!form.endDate) return "An end date is required before submitting.";
      const today = new Date().toISOString().slice(0, 10);
      if (form.endDate < today) {
        return "The end date is in the past — update it before submitting.";
      }
      if (form.productIds.length === 0) {
        return "Select at least one product before submitting.";
      }
    }

    return null;
  };

  const persist = async (nextSchemes, { submit = false } = {}) => {
    if (mode === "local") {
      if (!writeLocalSchemes(nextSchemes)) {
        setNotice({ tone: "error", message: "Could not save to this device (storage unavailable)." });
        return false;
      }
      setSchemes(nextSchemes);
      return true;
    }

    setBusy(true);

    try {
      const url = editingId
        ? `${API_URL}/api/sellers/schemes/${editingId}`
        : `${API_URL}/api/sellers/schemes`;
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          discountType: form.discountType,
          discountValue: Number(form.discountValue),
          productIds: form.productIds,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setNotice({
          tone: "error",
          message: data?.message || `Could not save the scheme (${response.status}).`,
        });
        return false;
      }

      if (submit) {
        const submitResponse = await fetch(
          `${API_URL}/api/sellers/schemes/${data.scheme.id}/submit`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const submitData = await submitResponse.json().catch(() => null);

        if (!submitResponse.ok || !submitData?.success) {
          await loadAll();
          setNotice({
            tone: "error",
            message:
              submitData?.message ||
              `Saved as Draft, but submit failed (${submitResponse.status}).`,
          });
          return false;
        }
      }

      await loadAll();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const error = validate(false);
    if (error) {
      setNotice({ tone: "error", message: error });
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      productIds: form.productIds,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: "Draft",
      adminNote: "",
      local: mode === "local",
    };

    let next;

    if (editingId) {
      next = schemes.map((scheme) =>
        scheme.id === editingId
          ? { ...scheme, ...payload, updatedAt: new Date().toISOString() }
          : scheme
      );
    } else {
      next = [
        {
          ...payload,
          id: `local-${Date.now()}`,
          sellerId: "local",
          storedStatus: "Draft",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...schemes,
      ];
    }

    const ok = await persist(next);

    if (ok) {
      cancelForm();
      setNotice({
        tone: "success",
        message:
          mode === "local"
            ? "Draft saved on this device (local preview — no server save)."
            : "Draft saved.",
      });
    }
  };

  const submitForApproval = async () => {
    const error = validate(true);
    if (error) {
      setNotice({ tone: "error", message: error });
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      productIds: form.productIds,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: "Pending Approval",
      adminNote: "",
      local: mode === "local",
    };

    let next;

    if (editingId) {
      next = schemes.map((scheme) =>
        scheme.id === editingId
          ? { ...scheme, ...payload, updatedAt: new Date().toISOString() }
          : scheme
      );
    } else {
      next = [
        {
          ...payload,
          id: `local-${Date.now()}`,
          sellerId: "local",
          storedStatus: "Pending Approval",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...schemes,
      ];
    }

    const ok = await persist(next, { submit: true });

    if (ok) {
      cancelForm();
      setNotice({
        tone: "success",
        message:
          mode === "local"
            ? "Submitted — saved on this device as Pending Approval (local preview; only an Admin on a scheme-enabled backend can approve)."
            : "Submitted for admin approval.",
      });
    }
  };

  const toggleProduct = (id) => {
    setForm((prev) => ({
      ...prev,
      productIds: prev.productIds.includes(id)
        ? prev.productIds.filter((value) => value !== id)
        : [...prev.productIds, id],
    }));
  };

  // ---- DISCOUNT PREVIEW (display only; pricing pipeline untouched) ----
  const previewRows = useMemo(() => {
    if (!form) return [];

    return products
      .filter((product) => form.productIds.includes(Number(product.id)))
      .map((product) => {
        const base = parseMoney(product.price);
        const current = parseMoney(product.customerPrice) > 0
          ? parseMoney(product.customerPrice)
          : base;
        const value = Number(form.discountValue) || 0;

        const rawDiscount =
          form.discountType === "percent"
            ? (current * value) / 100
            : value;

        const discount = Math.min(rawDiscount, Math.max(0, current - base));
        const final = Math.max(current - discount, base);

        return {
          id: product.id,
          name: product.name || `Product #${product.id}`,
          base,
          current,
          discount,
          final,
          capped: rawDiscount - discount > 0.01,
        };
      });
  }, [form, products]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ maxWidth: "980px", margin: "30px auto", padding: "20px", boxSizing: "border-box" }}>
      <div style={{ background: "#fff", padding: "25px", borderRadius: "14px", boxShadow: "0 4px 18px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, color: "#e91e63" }}>My Schemes</h2>
          <button
            type="button"
            onClick={onBack}
            style={{ border: "1px solid #ddd", background: "#fff", borderRadius: "8px", padding: "8px 14px", cursor: "pointer", fontWeight: "600" }}
          >
            ← Dashboard
          </button>
        </div>

        <p style={{ color: "#777", margin: "8px 0 16px" }}>
          Discount schemes need Admin approval before they become active.
          Draft → Pending Approval → Approved / Rejected. You can edit only
          Draft or Rejected schemes.
        </p>

        {mode === "local" && !loading && (
          <div role="status" style={{ padding: "12px 14px", marginBottom: "16px", borderRadius: "10px", background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: "13.5px" }}>
            ⚠ <strong>Local preview mode.</strong> This backend does not
            expose the scheme API yet (endpoints exist only in this
            repository's backend source), so schemes are saved on{" "}
            <strong>this device only</strong> and are not visible to Admin.
            Nothing here is active for buyers in any case — approval always
            requires a scheme-enabled backend.
          </div>
        )}

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            style={{
              padding: "11px 14px",
              marginBottom: "16px",
              borderRadius: "10px",
              fontSize: "13.5px",
              fontWeight: "600",
              background: notice.tone === "error" ? "#fef2f2" : "#ecfdf3",
              border: `1px solid ${notice.tone === "error" ? "#fecaca" : "#a7f3d0"}`,
              color: notice.tone === "error" ? "#b91c1c" : "#047857",
            }}
          >
            {notice.message}
          </div>
        )}

        {form ? (
          /* ================= CREATE / EDIT FORM ================= */
          <div>
            <h3 style={{ margin: "0 0 14px" }}>
              {editingId ? "Edit Scheme" : "New Scheme"}
            </h3>

            <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
              Scheme name *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Example: Monsoon Sale"
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px", marginBottom: "14px" }}
            />

            <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Short description buyers may see if the scheme is approved"
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px", marginBottom: "14px", resize: "vertical" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "12px", marginBottom: "14px" }}>
              <div>
                <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
                  Discount type *
                </label>
                <select
                  value={form.discountType}
                  onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px" }}
                >
                  <option value="percent">Percent (%)</option>
                  <option value="flat">Fixed amount (₹)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
                  Discount value * {form.discountType === "percent" ? "(0–100)" : "(₹)"}
                </label>
                <input
                  type="number"
                  min="0"
                  max={form.discountType === "percent" ? "100" : undefined}
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                  placeholder={form.discountType === "percent" ? "Example: 10" : "Example: 50"}
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
                  Start date
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
                  End date (required to submit)
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #d8deec", borderRadius: "10px", padding: "10px 12px", fontSize: "14px" }}
                />
              </div>
            </div>

            <label style={{ display: "block", fontWeight: "700", fontSize: "14px", marginBottom: "6px" }}>
              Products ({form.productIds.length} selected)
            </label>

            {products.length === 0 ? (
              <p style={{ color: "#777", fontSize: "13.5px" }}>
                No products loaded — your product list is unavailable from the
                API right now.
              </p>
            ) : (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", maxHeight: "230px", overflowY: "auto", padding: "8px 10px", marginBottom: "14px" }}>
                {products.map((product) => (
                  <label
                    key={product.id}
                    style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 4px", fontSize: "14px", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={form.productIds.includes(Number(product.id))}
                      onChange={() => toggleProduct(Number(product.id))}
                    />
                    <span style={{ flex: 1 }}>{product.name || `Product #${product.id}`}</span>
                    <span style={{ color: "#777", fontSize: "13px" }}>
                      {money(parseMoney(product.customerPrice) > 0 ? parseMoney(product.customerPrice) : parseMoney(product.price))}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* ============ DISCOUNT PREVIEW (display only) ============ */}
            {previewRows.length > 0 && (
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
                <h4 style={{ margin: "0 0 4px" }}>Discount preview</h4>
                <p style={{ margin: "0 0 12px", color: "#666", fontSize: "12.5px" }}>
                  Display only — platform fee, delivery, GST and JustBrand
                  Family commission stay exactly as configured; final price
                  never drops below your selling (base) price.
                </p>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#555" }}>
                        <th style={{ padding: "6px 8px" }}>Product</th>
                        <th style={{ padding: "6px 8px" }}>Current final price</th>
                        <th style={{ padding: "6px 8px" }}>Scheme discount</th>
                        <th style={{ padding: "6px 8px" }}>Final price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.id} style={{ borderTop: "1px solid #eef0f4" }}>
                          <td style={{ padding: "7px 8px" }}>{row.name}</td>
                          <td style={{ padding: "7px 8px" }}>{money(row.current)}</td>
                          <td style={{ padding: "7px 8px", color: "#d32f2f" }}>
                            −{money(row.discount)}
                            {row.capped ? " (capped)" : ""}
                          </td>
                          <td style={{ padding: "7px 8px", fontWeight: "700" }}>
                            {money(row.final)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={saveDraft}
                disabled={busy}
                style={{ padding: "11px 20px", borderRadius: "10px", border: "1px solid #d9d9e0", background: "#fff", fontWeight: "700", cursor: busy ? "wait" : "pointer" }}
              >
                {busy ? "Saving…" : "Save Draft"}
              </button>

              <button
                type="button"
                onClick={submitForApproval}
                disabled={busy}
                style={{ padding: "11px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(90deg,#ff7a00,#e91e63)", color: "#fff", fontWeight: "700", cursor: busy ? "wait" : "pointer" }}
              >
                {busy ? "Submitting…" : "Submit for Approval"}
              </button>

              <button
                type="button"
                onClick={cancelForm}
                disabled={busy}
                style={{ padding: "11px 20px", borderRadius: "10px", border: "1px solid #d9d9e0", background: "#fff", fontWeight: "700", cursor: busy ? "wait" : "pointer" }}
              >
                Cancel
              </button>
            </div>

            <p style={{ color: "#8b8b94", fontSize: "12px", margin: "12px 0 0" }}>
              "Submit for Approval" moves the scheme to Pending Approval.
              Only an Admin can approve or reject it — sellers can never
              activate their own schemes.
            </p>
          </div>
        ) : (
          /* ================= LIST VIEW ================= */
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
              <h3 style={{ margin: 0 }}>
                {loading ? "Loading schemes…" : `${schemes.length} scheme${schemes.length === 1 ? "" : "s"}`}
              </h3>
              <button
                type="button"
                onClick={startCreate}
                disabled={loading}
                style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "linear-gradient(90deg,#ff7a00,#e91e63)", color: "#fff", fontWeight: "700", cursor: "pointer" }}
              >
                + New Scheme
              </button>
            </div>

            {!loading && schemes.length === 0 && (
              <p style={{ color: "#777", textAlign: "center", padding: "26px 0" }}>
                No schemes yet. Create one, then submit it for Admin approval.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {schemes.map((scheme) => {
                const editable = scheme.status === "Draft" || scheme.status === "Rejected";
                const canSubmit =
                  editable && scheme.endDate && scheme.endDate >= today && (scheme.productIds || []).length > 0;

                return (
                  <div
                    key={scheme.id}
                    style={{ border: "1px solid #e8e8ee", borderRadius: "12px", padding: "14px 16px" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "15.5px" }}>{scheme.name}</strong>
                      <StatusBadge status={scheme.status} />
                      {scheme.local && (
                        <span style={{ fontSize: "11px", color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "20px", padding: "2px 8px" }}>
                          On this device
                        </span>
                      )}
                    </div>

                    {scheme.description && (
                      <p style={{ margin: "6px 0 0", color: "#555", fontSize: "13.5px" }}>{scheme.description}</p>
                    )}

                    <p style={{ margin: "8px 0 0", color: "#444", fontSize: "13.5px" }}>
                      {scheme.discountType === "percent"
                        ? `${scheme.discountValue}% off`
                        : `${money(scheme.discountValue)} off`}{" "}
                      · {(scheme.productIds || []).length} product
                      {(scheme.productIds || []).length === 1 ? "" : "s"}
                      {scheme.startDate ? ` · from ${scheme.startDate}` : ""}
                      {scheme.endDate ? ` until ${scheme.endDate}` : ""}
                    </p>

                    {scheme.status === "Rejected" && scheme.adminNote && (
                      <p style={{ margin: "8px 0 0", color: "#b91c1c", fontSize: "13px" }}>
                        Admin note: {scheme.adminNote}
                      </p>
                    )}

                    {(scheme.status === "Pending Approval" || scheme.status === "Approved") && (
                      <p style={{ margin: "8px 0 0", color: "#777", fontSize: "12.5px" }}>
                        {scheme.status === "Pending Approval"
                          ? "Waiting for Admin approval — not active for buyers."
                          : "Approved by Admin — applies only until the end date."}
                      </p>
                    )}

                    <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => startEdit(scheme)}
                          style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #d9d9e0", background: "#fff", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
                        >
                          Edit
                        </button>
                      )}

                      {!editable && (
                        <span style={{ alignSelf: "center", color: "#8b8b94", fontSize: "12.5px" }}>
                          Read-only while {scheme.status.toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MySchemes;

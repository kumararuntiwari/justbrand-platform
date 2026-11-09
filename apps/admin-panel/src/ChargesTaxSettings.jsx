import { useCallback, useEffect, useState } from "react";

// =====================================================
// ADMIN — CHARGES & TAX SETTINGS
// =====================================================
// Delivery charge (flat / % / order-value & method rules), platform
// fee (flat / %, per order OR per product), category-wise GST rates
// with product-level overrides, GST review flags, and the platform
// revenue report. Every save round-trips to the authenticated admin
// endpoints — the backend re-validates and reprices; nothing here is
// trusted client-side. Each card also shows the PREVIOUS saved value.

import { API } from "./apiConfig";

const DELIVERY_MODES = [
  { value: "flat", label: "Flat ₹ amount" },
  { value: "percent", label: "% of order value" },
];

const FEE_MODES = [
  { value: "percent", label: "% (percentage)" },
  { value: "flat", label: "₹ (fixed amount)" },
];

function Card({ title, description, actions, children }) {
  return (
    <section className="products-section">
      <div className="section-title">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="cm-field">
      <span className="cm-field-label">{label}</span>
      {children}
      {hint ? <small className="cm-field-hint">{hint}</small> : null}
    </label>
  );
}

function money(value) {
  const n = Number(value) || 0;
  return `₹${n.toFixed(2)}`;
}

function describeDelivery(settings) {
  if (!settings) return "—";
  const base =
    settings.mode === "percent"
      ? `${settings.value}% of order value`
      : `₹${Number(settings.value).toFixed(0)} flat`;
  const free =
    settings.freeAboveOrderValue > 0
      ? ` · free above ₹${Number(settings.freeAboveOrderValue).toFixed(0)}`
      : "";
  const rules = (settings.rules || []).length
    ? ` · ${settings.rules.length} special rule${settings.rules.length > 1 ? "s" : ""}`
    : "";
  return `${base}${free}${rules}`;
}

function describePlatform(settings) {
  if (!settings) return "—";
  if (!settings.enabled) return "Disabled (0 fee)";
  const amount =
    settings.mode === "percent" ? `${settings.value}%` : `₹${Number(settings.value).toFixed(0)}`;
  const basis = settings.basis === "per_order" ? "once per order" : "per product unit";
  return `${amount} ${basis}`;
}

export default function ChargesTaxSettings({ token, onMessage }) {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [loadError, setLoadError] = useState("");

  const [delivery, setDelivery] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [gst, setGst] = useState(null);
  const [previous, setPrevious] = useState({});
  const [meta, setMeta] = useState({ originStates: [], validGstSlabs: [] });
  const [categoryRates, setCategoryRates] = useState([]);

  const [revenue, setRevenue] = useState(null);
  const [review, setReview] = useState(null);
  const [categories, setCategories] = useState([]);
  const [taxEdits, setTaxEdits] = useState({});
  const [rateDraft, setRateDraft] = useState({ category: "", gstRate: "18", hsnCode: "" });
  const [rateError, setRateError] = useState("");

  const api = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        throw new Error("Session expired — please log in again.");
      }
      if (response.status === 403) {
        throw new Error(
          data?.message || "Your staff role is not allowed to manage charges."
        );
      }
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Request failed (${response.status}).`);
      }
      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api("/api/admin/charges/settings");
      setDelivery(data.delivery);
      setPlatform(data.platformFee);
      setGst(data.gst);
      setPrevious(data.previous || {});
      setCategoryRates(data.categoryRates || []);
      setMeta({
        originStates: data.originStates || [],
        validGstSlabs: data.validGstSlabs || [],
      });

      const [rev, revList, cats] = await Promise.all([
        api("/api/admin/charges/platform-revenue").catch(() => null),
        api("/api/admin/charges/gst-review").catch(() => null),
        fetch(`${API}/api/categories`)
          .then((r) => r.json().catch(() => null))
          .catch(() => null),
      ]);
      setRevenue(rev);
      setReview(revList);
      setCategories(
        (cats?.categories || []).map((c) =>
          typeof c === "string" ? c : c.name || c.title || ""
        ).filter(Boolean)
      );
    } catch (error) {
      setLoadError(error.message || "Could not load charge settings.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // ---------------- saves ----------------

  async function save(key, path, body, apply) {
    setSavingKey(key);
    try {
      const data = await api(path, { method: "PUT", body });
      apply(data);
      onMessage(`✅ ${data.message || "Settings saved."}`);
      // Refresh revenue + review lists (they depend on the settings).
      const [rev, revList] = await Promise.all([
        api("/api/admin/charges/platform-revenue").catch(() => null),
        api("/api/admin/charges/gst-review").catch(() => null),
      ]);
      if (rev) setRevenue(rev);
      if (revList) setReview(revList);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSavingKey("");
    }
  }

  function saveDelivery() {
    save(
      "delivery",
      "/api/admin/charges/delivery",
      delivery,
      (data) => {
        setDelivery(data.delivery);
        setPrevious((prev) => ({ ...prev, delivery: data.previous || null }));
      }
    );
  }

  function savePlatform() {
    save(
      "platform",
      "/api/admin/charges/platform-fee",
      platform,
      (data) => {
        setPlatform(data.platformFee);
        setPrevious((prev) => ({ ...prev, platformFee: data.previous || null }));
      }
    );
  }

  function saveGst() {
    save(
      "gst",
      "/api/admin/charges/gst",
      gst,
      (data) => {
        setGst(data.gst);
        setPrevious((prev) => ({ ...prev, gst: data.previous || null }));
      }
    );
  }

  async function saveRate() {
    const category = rateDraft.category.trim();
    setRateError("");
    if (!category) {
      setRateError("Pick or type a category first.");
      return;
    }
    setSavingKey(`rate:${category}`);
    try {
      const data = await api("/api/admin/charges/gst-rates", {
        method: "PUT",
        body: {
          category,
          gstRate: Number(rateDraft.gstRate),
          hsnCode: rateDraft.hsnCode.trim(),
        },
      });
      setCategoryRates(data.categoryRates || []);
      setRateDraft({ category: "", gstRate: "18", hsnCode: "" });
      onMessage(`✅ ${data.message}`);
      const revList = await api("/api/admin/charges/gst-review").catch(() => null);
      if (revList) setReview(revList);
    } catch (error) {
      setRateError(error.message);
      onMessage(`❌ ${error.message}`);
    } finally {
      setSavingKey("");
    }
  }

  async function clearRate(category) {
    if (!window.confirm(`Clear the GST default for “${category}”? Products in it will flag for review.`)) {
      return;
    }
    setSavingKey(`rate:${category}`);
    try {
      const data = await api("/api/admin/charges/gst-rates", {
        method: "PUT",
        body: { category, gstRate: null },
      });
      setCategoryRates(data.categoryRates || []);
      onMessage(`✅ ${data.message}`);
      const revList = await api("/api/admin/charges/gst-review").catch(() => null);
      if (revList) setReview(revList);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSavingKey("");
    }
  }

  async function applyProductTax(productId) {
    const edit = taxEdits[productId];
    if (!edit) return;
    setSavingKey(`tax:${productId}`);
    try {
      const data = await api(`/api/admin/products/${productId}/tax`, {
        method: "PUT",
        body: {
          gstRate: edit.gstRate === "" ? null : Number(edit.gstRate),
          hsnCode: edit.hsnCode || "",
        },
      });
      onMessage(`✅ ${data.message}`);
      const revList = await api("/api/admin/charges/gst-review").catch(() => null);
      if (revList) setReview(revList);
      setTaxEdits((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSavingKey("");
    }
  }

  // ---------------- delivery rule helpers ----------------

  function updateRule(index, patch) {
    setDelivery((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  }

  if (loading) {
    return (
      <div className="sec-wrap">
        <div className="ov-skeleton-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ov-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sec-wrap">
        <div className="empty">
          <p>❌ {loadError}</p>
          <button type="button" className="refresh-btn" style={{ marginTop: "10px" }} onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const slabs = meta.validGstSlabs.length ? meta.validGstSlabs : [0, 1.5, 3, 5, 12, 18, 28];
  const exampleOrder = 1000;
  const exampleFee =
    platform.basis === "per_order"
      ? platform.mode === "percent"
        ? (exampleOrder * platform.value) / 100
        : platform.value
      : platform.mode === "percent"
      ? (exampleOrder * platform.value) / 100
      : platform.value;

  return (
    <div className="sec-wrap">
      {/* ============ 1. DELIVERY CHARGE ============ */}
      <Card
        title="🚚 Delivery Charge"
        description="Applied by the backend on every order. Percent charges use the order value (item subtotal); the free-above threshold and special rules win over the default."
        actions={
          <button
            type="button"
            className="approve"
            disabled={savingKey === "delivery"}
            onClick={saveDelivery}
          >
            {savingKey === "delivery" ? "Saving…" : "✓ Save delivery"}
          </button>
        }
      >
        <div className="cm-grid2">
          <Field label="Charge type">
            <select
              className="cm-input cm-select"
              value={delivery.mode}
              onChange={(e) => setDelivery({ ...delivery, mode: e.target.value })}
            >
              {DELIVERY_MODES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={delivery.mode === "percent" ? "Percentage (%)" : "Amount (₹)"}
            hint={
              delivery.mode === "percent"
                ? "Percentage of the item subtotal, e.g. 5 = 5%."
                : "Fixed rupees charged once per order."
            }
          >
            <input
              type="number"
              className="cm-input"
              min="0"
              max={delivery.mode === "percent" ? "100" : "100000"}
              value={delivery.value}
              onChange={(e) => setDelivery({ ...delivery, value: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="cm-grid2">
          <Field
            label="Free delivery above order value (₹)"
            hint="0 disables the threshold. When the item subtotal reaches it, delivery becomes ₹0."
          >
            <input
              type="number"
              className="cm-input"
              min="0"
              value={delivery.freeAboveOrderValue}
              onChange={(e) =>
                setDelivery({ ...delivery, freeAboveOrderValue: Number(e.target.value) })
              }
            />
          </Field>
          <div />
        </div>

        <div className="cm-subhead">Special rules (checked top-to-bottom, before the default)</div>
        {(delivery.rules || []).map((rule, index) => (
          <div className="cm-grid4" key={index}>
            <Field label={`Rule ${index + 1} — method`} hint="Empty = any delivery method.">
              <input
                className="cm-input"
                placeholder="e.g. Express"
                value={rule.method || ""}
                onChange={(e) => updateRule(index, { method: e.target.value })}
              />
            </Field>
            <Field label="Order value from (₹)">
              <input
                type="number"
                className="cm-input"
                min="0"
                value={rule.minOrderValue}
                onChange={(e) => updateRule(index, { minOrderValue: Number(e.target.value) })}
              />
            </Field>
            <Field label="Order value up to (₹)" hint="Blank = no upper limit.">
              <input
                type="number"
                className="cm-input"
                min="0"
                placeholder="∞"
                value={rule.maxOrderValue ?? ""}
                onChange={(e) =>
                  updateRule(index, {
                    maxOrderValue: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Charge">
              <div style={{ display: "flex", gap: "6px" }}>
                <select
                  className="cm-input cm-select"
                  value={rule.mode}
                  onChange={(e) => updateRule(index, { mode: e.target.value })}
                >
                  {DELIVERY_MODES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="cm-input"
                  min="0"
                  style={{ maxWidth: "90px" }}
                  value={rule.value}
                  onChange={(e) => updateRule(index, { value: Number(e.target.value) })}
                />
                <button
                  type="button"
                  className="reject"
                  title="Remove rule"
                  onClick={() =>
                    setDelivery((prev) => ({
                      ...prev,
                      rules: prev.rules.filter((_, i) => i !== index),
                    }))
                  }
                >
                  ✕
                </button>
              </div>
            </Field>
          </div>
        ))}
        <div className="cm-actions">
          <button
            type="button"
            className="refresh-btn"
            onClick={() =>
              setDelivery((prev) => ({
                ...prev,
                rules: [
                  ...(prev.rules || []),
                  { method: "", minOrderValue: 0, maxOrderValue: null, mode: "flat", value: 0 },
                ],
              }))
            }
          >
            ＋ Add rule
          </button>
        </div>

        <p className="ov-note">
          <strong>Current:</strong> {describeDelivery(delivery)}
          {previous.delivery ? (
            <>
              {" · "}
              <strong>Previous:</strong> {describeDelivery(previous.delivery)}
            </>
          ) : (
            " · No previous save yet."
          )}
        </p>
      </Card>

      {/* ============ 2. PLATFORM FEE ============ */}
      <Card
        title="💰 Platform Fee"
        description="Charged by the backend on every order — on exactly ONE basis, never twice. Per product = on each unit; per order = once on the whole subtotal."
        actions={
          <button
            type="button"
            className="approve"
            disabled={savingKey === "platform"}
            onClick={savePlatform}
          >
            {savingKey === "platform" ? "Saving…" : "✓ Save fee"}
          </button>
        }
      >
        <label className="cm-checkline" style={{ marginBottom: "10px" }}>
          <input
            type="checkbox"
            checked={platform.enabled}
            onChange={(e) => setPlatform({ ...platform, enabled: e.target.checked })}
          />
          Platform fee enabled
        </label>

        <div className="cm-grid4">
          <Field label="Fee type">
            <select
              className="cm-input cm-select"
              value={platform.mode}
              onChange={(e) => setPlatform({ ...platform, mode: e.target.value })}
            >
              {FEE_MODES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={platform.mode === "percent" ? "Percentage (%)" : "Amount (₹)"}
          >
            <input
              type="number"
              className="cm-input"
              min="0"
              max={platform.mode === "percent" ? "100" : "100000"}
              value={platform.value}
              onChange={(e) => setPlatform({ ...platform, value: Number(e.target.value) })}
            />
          </Field>
          <Field label="Charge basis">
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
              <label className="cm-checkline">
                <input
                  type="radio"
                  name="platform-basis"
                  checked={platform.basis === "per_order"}
                  onChange={() => setPlatform({ ...platform, basis: "per_order" })}
                />
                Per order (once)
              </label>
              <label className="cm-checkline">
                <input
                  type="radio"
                  name="platform-basis"
                  checked={platform.basis === "per_product"}
                  onChange={() => setPlatform({ ...platform, basis: "per_product" })}
                />
                Per product (per unit)
              </label>
            </div>
          </Field>
          <Field label="Worked example (₹1000 order)">
            <div className="cm-fitchip" style={{ marginTop: "6px" }}>
              {platform.enabled ? `Fee = ${money(exampleFee)}` : "Fee = ₹0.00 (disabled)"}
            </div>
          </Field>
        </div>

        <p className="ov-note">
          <strong>Current:</strong> {describePlatform(platform)}
          {previous.platformFee ? (
            <>
              {" · "}
              <strong>Previous:</strong> {describePlatform(previous.platformFee)}
            </>
          ) : (
            " · No previous save yet."
          )}
        </p>
      </Card>

      {/* ============ 3. GST MODE ============ */}
      <Card
        title="🧾 GST Settings"
        description="Place-of-supply origin decides the tax breakup: same state = CGST + SGST, different state = IGST. Inclusive mode extracts GST from your selling prices instead of adding it."
        actions={
          <button type="button" className="approve" disabled={savingKey === "gst"} onClick={saveGst}>
            {savingKey === "gst" ? "Saving…" : "✓ Save GST settings"}
          </button>
        }
      >
        <div className="cm-grid2">
          <Field
            label="Supply-from state (place of supply origin)"
            hint="Required for the CGST/SGST vs IGST split. Until set, tax totals still compute but the split is flagged, never guessed."
          >
            <select
              className="cm-input cm-select"
              value={gst.originState}
              onChange={(e) => setGst({ ...gst, originState: e.target.value })}
            >
              <option value="">— Not configured —</option>
              {meta.originStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pricing mode">
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
              <label className="cm-checkline">
                <input
                  type="radio"
                  name="gst-mode"
                  checked={!gst.priceIncludesGst}
                  onChange={() => setGst({ ...gst, priceIncludesGst: false })}
                />
                GST-exclusive — tax added on top of the price
              </label>
              <label className="cm-checkline">
                <input
                  type="radio"
                  name="gst-mode"
                  checked={gst.priceIncludesGst}
                  onChange={() => setGst({ ...gst, priceIncludesGst: true })}
                />
                GST-inclusive — selling price already contains the tax
              </label>
            </div>
          </Field>
        </div>
        <p className="ov-note">
          <strong>Current:</strong>{" "}
          {gst.originState
            ? `Origin: ${gst.originState}`
            : "Origin not configured (split flagged)"}
          {" · "}
          {gst.priceIncludesGst ? "GST-inclusive prices" : "GST-exclusive prices"}
          {previous.gst ? (
            <>
              {" · "}
              <strong>Previous:</strong>{" "}
              {previous.gst.originState
                ? `Origin: ${previous.gst.originState}`
                : "Origin not configured"}
              {previous.gst.priceIncludesGst ? " · inclusive" : " · exclusive"}
            </>
          ) : (
            " · No previous save yet."
          )}
        </p>
      </Card>

      {/* ============ 4. CATEGORY GST RATES ============ */}
      <Card
        title="📂 Category-wise GST Rates"
        description="The category rate is the DEFAULT for its (sub-)category products. A product-level HSN/GST override always wins. Rates are restricted to statutory slabs — nothing is ever guessed."
      >
        <div className="cm-grid4">
          <Field label="Category / subcategory">
            <input
              className="cm-input"
              list="chg-category-list"
              placeholder="e.g. Sarees"
              value={rateDraft.category}
              onChange={(e) => setRateDraft({ ...rateDraft, category: e.target.value })}
            />
            <datalist id="chg-category-list">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="GST rate">
            <select
              className="cm-input cm-select"
              value={rateDraft.gstRate}
              onChange={(e) => setRateDraft({ ...rateDraft, gstRate: e.target.value })}
            >
              {slabs.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default HSN code (optional)">
            <input
              className="cm-input"
              placeholder="4–8 digits"
              value={rateDraft.hsnCode}
              onChange={(e) => setRateDraft({ ...rateDraft, hsnCode: e.target.value })}
            />
          </Field>
          <Field label=" ">
            <button
              type="button"
              className="approve"
              disabled={savingKey.startsWith("rate:")}
              onClick={saveRate}
            >
              {savingKey.startsWith("rate:") ? "Saving…" : "✓ Save rate"}
            </button>
          </Field>
        </div>
        {rateError ? <div className="cm-error">{rateError}</div> : null}

        <div className="sec-tablewrap">
          {categoryRates.length === 0 ? (
            <div className="empty">
              No category rates configured yet — products without a rate are flagged for review
              (charged at 0% until classified).
            </div>
          ) : (
            <table className="sec-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>GST rate</th>
                  <th>HSN</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categoryRates.map((rate) => (
                  <tr key={rate.category}>
                    <td>
                      <strong>{rate.category}</strong>
                    </td>
                    <td>
                      <span className="sec-tag sec-tag-good">{rate.gstRate}%</span>
                    </td>
                    <td>{rate.hsnCode || "—"}</td>
                    <td>
                      <small>{rate.updatedAt || "—"}</small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="reject"
                        disabled={savingKey === `rate:${rate.category}`}
                        onClick={() => clearRate(rate.category)}
                      >
                        Clear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ============ 5. GST REVIEW FLAGS ============ */}
      <Card
        title="🚩 GST Review Flags"
        description="Products whose GST classification is unclear — no category rate, a missing HSN, or an invalid override. They charge at 0% (never a guessed rate) until you classify them explicitly."
      >
        <div className="sec-tablewrap">
          {!review || review.products?.length === 0 ? (
            <div className="empty">
              ✅ Every product has a valid GST classification — nothing pending review.
            </div>
          ) : (
            <table className="sec-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Flags</th>
                  <th>Effective rate</th>
                  <th>Set classification</th>
                </tr>
              </thead>
              <tbody>
                {review.products.map((product) => {
                  const edit = taxEdits[product.id] || { gstRate: "", hsnCode: "" };
                  return (
                    <tr key={product.id}>
                      <td className="sch-cell">
                        <strong>{product.name}</strong>
                        <small>
                          {product.hsnCode ? `HSN ${product.hsnCode}` : "No HSN on product"}
                        </small>
                      </td>
                      <td>{product.category}</td>
                      <td>
                        {product.flags.map((flag) => (
                          <span key={flag} className="sec-tag sec-tag-warn" style={{ marginRight: "4px" }}>
                            {flag.replace(/_/g, " ")}
                          </span>
                        ))}
                      </td>
                      <td>
                        <span className="sec-tag">{product.gstRate}%</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <select
                            className="cm-input cm-select"
                            style={{ maxWidth: "90px" }}
                            value={edit.gstRate}
                            onChange={(e) =>
                              setTaxEdits((prev) => ({
                                ...prev,
                                [product.id]: { ...edit, gstRate: e.target.value },
                              }))
                            }
                          >
                            <option value="">rate</option>
                            {slabs
                              .filter((rate) => rate > 0)
                              .map((rate) => (
                                <option key={rate} value={rate}>
                                  {rate}%
                                </option>
                              ))}
                          </select>
                          <input
                            className="cm-input"
                            style={{ maxWidth: "110px" }}
                            placeholder="HSN"
                            value={edit.hsnCode}
                            onChange={(e) =>
                              setTaxEdits((prev) => ({
                                ...prev,
                                [product.id]: { ...edit, hsnCode: e.target.value },
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="approve"
                            disabled={
                              savingKey === `tax:${product.id}` ||
                              (!edit.gstRate && !edit.hsnCode)
                            }
                            onClick={() => applyProductTax(product.id)}
                          >
                            {savingKey === `tax:${product.id}` ? "…" : "Apply"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ============ 6. PLATFORM REVENUE ============ */}
      <Card
        title="📊 Platform Revenue & Fee Breakdown"
        description="Order-wise fee breakdown recorded by the backend at checkout. Older orders (placed before this feature) carry no fee breakdown and are not counted — nothing historical is rewritten."
        actions={
          <button type="button" className="refresh-btn" onClick={load}>
            ⟳ Refresh
          </button>
        }
      >
        <div className="chg-tiles">
          <div className="chg-tile">
            <span>Platform fee collected</span>
            <strong>{money(revenue?.totalCollected)}</strong>
          </div>
          <div className="chg-tile">
            <span>Orders with breakdown</span>
            <strong>{revenue?.orderCount ?? 0}</strong>
          </div>
          <div className="chg-tile">
            <span>Delivery collected</span>
            <strong>{money(revenue?.deliveryCollected)}</strong>
          </div>
          <div className="chg-tile">
            <span>GST collected</span>
            <strong>{money(revenue?.gstCollected)}</strong>
          </div>
        </div>

        <div className="sec-tablewrap">
          {!revenue || revenue.recent.length === 0 ? (
            <div className="empty">No orders with a fee breakdown yet.</div>
          ) : (
            <table className="sec-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Order total</th>
                  <th>Platform fee</th>
                  <th>Delivery</th>
                  <th>GST</th>
                  <th>Tax split</th>
                </tr>
              </thead>
              <tbody>
                {revenue.recent.map((row) => (
                  <tr key={row.orderNumber}>
                    <td>
                      <strong>{row.orderNumber}</strong>
                    </td>
                    <td>
                      <small>{String(row.createdAt || "").slice(0, 10)}</small>
                    </td>
                    <td>₹{Number(row.totalAmount || 0).toFixed(2)}</td>
                    <td>
                      <span className="sec-tag sec-tag-good">{money(row.platformFee)}</span>
                      {row.platformBasis ? <small> ({row.platformBasis})</small> : null}
                    </td>
                    <td>{money(row.deliveryCharge)}</td>
                    <td>{money(row.gstAmount)}</td>
                    <td>
                      <span className="sec-tag">
                        {row.splitMode === "intra"
                          ? "CGST+SGST"
                          : row.splitMode === "inter"
                          ? "IGST"
                          : row.splitMode
                          ? row.splitMode.replace(/_/g, " ")
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

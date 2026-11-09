import React, { useEffect, useMemo, useState } from "react";
import "../index.css";
import ProductImageManager from "../components/ProductImageManager";

import { API_URL } from "../api.js";
const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];

export default function AddProduct() {
  // Phase 1: admin-managed category suggestions. The input stays
  // free text — if the API fails, typing a category works exactly
  // as before (no behavior change for existing flows).
  const [categorySuggestions, setCategorySuggestions] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch(`${API_URL}/api/categories`);

        if (!response.ok) return;

        const data = await response.json().catch(() => null);

        if (!cancelled && data?.success && Array.isArray(data.categories)) {
          const names = [];
          for (const c of data.categories) {
            if (c?.name) names.push(c.name);
            for (const child of c?.children || []) {
              if (child?.name) names.push(child.name);
            }
          }
          setCategorySuggestions(names);
        }
      } catch {
        // Fallback safety: free-text category entry keeps working.
      }
    }

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  const [form, setForm] = useState({
    name: "",
    category: "",
    subCategory: "",
    sku: "",
    price: "",
    comparePrice: "",
    hsnCode: "",
    gstRate: "",
    stock: "",
    description: "",
    shortDetails: "",
  });

  // Admin-verified GST suggestion for the selected category / HSN.
  // The server always resolves the final rate: a suggestion is a hint,
  // and an approved mapping always beats the seller's own entry.
  const [gstSuggestion, setGstSuggestion] = useState({
    loading: false,
    suggestion: null,
    requiresReview: true,
    reason: "",
  });

  const [rules, setRules] = useState({
    deliveryFlat: 40,
    platformPercent: 5,
    mlmPercent: 3,
  });
  const [kycStatus, setKycStatus] = useState("Pending");
  const [taxProfile, setTaxProfile] = useState(null);
  const canSell = Boolean(taxProfile?.canSell);
  // TRUE when the live pricing-rules fetch fails — the preview then
  // runs on the built-in defaults (40/5/3), which may differ from the
  // admin-configured rules. The seller is warned instead of being
  // silently shown a possibly-wrong customer price.
  const [rulesError, setRulesError] = useState(false);

  // Multi-image state (1–6). images[0] = primary/main image.
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);

  const token = localStorage.getItem("justbrand_seller_token") || "";

  useEffect(() => {
    if (!token) return;

    Promise.all([
      fetch(`${API_URL}/api/sellers/pricing-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/api/sellers/me`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([pricingData, sellerData]) => {
        setRulesError(!(pricingData?.success && pricingData.rules));

        if (pricingData?.success && pricingData.rules) {
          setRules(pricingData.rules);
        }
        if (sellerData?.success) {
          setKycStatus(sellerData.seller?.kycStatus || "Pending");
          setTaxProfile(sellerData.seller?.taxProfile || null);
        }
      })
      .catch((error) => {
        setRulesError(true);
        console.error("Seller pricing/KYC load error:", error);
      })
      .finally(() => setLoadingRules(false));
  }, [token]);

  useEffect(() => {
    const category = form.category.trim();
    if (!category || !token) {
      setGstSuggestion({ loading: false, suggestion: null, requiresReview: true, reason: "" });
      return undefined;
    }

    let cancelled = false;
    setGstSuggestion((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ category });
        if (form.subCategory.trim()) params.set("subCategory", form.subCategory.trim());
        if (form.hsnCode.trim()) params.set("hsnCode", form.hsnCode.trim());

        const response = await fetch(`${API_URL}/api/sellers/gst-suggestions?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => null);
        if (cancelled || !data?.success) return;

        setGstSuggestion({
          loading: false,
          suggestion: data.suggestion,
          requiresReview: Boolean(data.requiresReview),
          reason: data.reason || "",
        });

        // Auto-fill the admin-verified HSN/rate. Free-text entry stays
        // available when no mapping exists (then it needs admin review).
        if (data.suggestion) {
          setForm((prev) => ({
            ...prev,
            hsnCode: prev.hsnCode.trim() || data.suggestion.hsnCode || prev.hsnCode,
            gstRate: String(data.suggestion.gstRate),
          }));
        }
      } catch {
        if (!cancelled) {
          setGstSuggestion({ loading: false, suggestion: null, requiresReview: true, reason: "" });
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category, form.subCategory, form.hsnCode, token]);

  const pricing = useMemo(() => {
    const base = Number(form.price) || 0;
    const gst = Number(form.gstRate) || 0;
    const platform = base * Number(rules.platformPercent || 0) / 100;
    const mlm = base * Number(rules.mlmPercent || 0) / 100;
    const delivery = Number(rules.deliveryFlat || 0);
    const taxable = base + platform + mlm + delivery;
    const gstAmount = taxable * gst / 100;
    const customerPrice = Math.ceil((taxable + gstAmount) * 100) / 100;

    return { base, platform, mlm, delivery, gstAmount, customerPrice, gst };
  }, [form.price, form.gstRate, rules]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (kycStatus !== "Approved") {
      alert("Product submit/approval ke liye pehle Seller KYC Admin se Approved hona chahiye.");
      return;
    }

    if (!canSell) {
      alert(
        "PAN verification aur Admin GSTIN approval ke bina product listing/selling allowed nahi hai. Seller KYC page se GSTIN submit karke Admin approval lein."
      );
      return;
    }

    if (!form.name.trim() || !form.category.trim() || !form.price.trim()) {
      alert("Product name, category aur selling price required hain.");
      return;
    }

    if (!form.hsnCode.trim()) {
      alert("HSN/SAC code enter kijiye. GST rate HSN/category ke according confirm kijiye.");
      return;
    }

    if (form.gstRate === "") {
      alert("GST rate select kijiye.");
      return;
    }

    if (images.length < 1) {
      alert("Kam se kam 1 product image add kijiye.");
      return;
    }

    // LIMITED STOCK TRACKING: blank = unlimited (untracked). When a
    // value is entered it must be a whole number of 0 or more —
    // negative or fractional quantities are rejected here AND again
    // on the server.
    if (form.stock.trim() !== "") {
      const stockValue = Number(form.stock);
      if (!Number.isInteger(stockValue) || stockValue < 0) {
        alert("Stock quantity whole number 0 ya usse zyada honi chahiye (0 = out of stock). Blank chhodne par unlimited mana jayega.");
        return;
      }
    }

    setSaving(true);

    try {
      if (!token) {
        alert("Your session has expired. Please login again.");
        return;
      }

      const response = await fetch(`${API_URL}/api/sellers/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim(),
          subCategory: form.subCategory.trim(),
          sku: form.sku.trim(),
          price: form.price.trim(),
          comparePrice: form.comparePrice.trim(),
          hsnCode: form.hsnCode.trim(),
          gstRate: Number(form.gstRate),
          image: images[0] || "",
          images,
          description: form.description.trim(),
          shortDetails: form.shortDetails.trim(),
          // Blank → null = unlimited (untracked); otherwise the
          // validated non-negative integer.
          stock: form.stock.trim() === "" ? null : Number(form.stock),
        }),
      });

      const data = await response.json();

      if (response.status === 401) {
        localStorage.removeItem("justbrand_seller_token");
        localStorage.removeItem("justbrand_seller_logged_in");
        alert("Your session has expired. Please login again.");
        return;
      }

      if (response.status === 403 && data.code === "KYC_REQUIRED") {
        setKycStatus(data.kycStatus || "Pending");
        alert(data.message);
        return;
      }

      if (response.status === 403 && data.code === "SELLER_GST_REQUIRED") {
        setTaxProfile(data.taxProfile || taxProfile);
        alert(data.message);
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Product save failed.");
      }

      alert("Product submit ho gaya. GST-approved seller ka product Admin approval ke baad Buyer App me dikhega.");

      setForm({
        name: "",
        category: "",
        subCategory: "",
        sku: "",
        price: "",
        comparePrice: "",
        hsnCode: "",
        gstRate: "",
        stock: "",
        description: "",
        shortDetails: "",
      });
      setImages([]);
    } catch (error) {
      console.error("Add Product Error:", error);
      alert(error.message || "Product save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "12px",
    marginTop: "6px",
    marginBottom: "16px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontSize: "15px",
    boxSizing: "border-box",
  };

  const labelStyle = {
    fontWeight: "600",
    display: "block",
    marginBottom: "4px",
  };

  return (
    <div style={{ maxWidth: "900px", margin: "30px auto", padding: "20px", boxSizing: "border-box" }}>
      <div style={{ background: "#fff", padding: "25px", borderRadius: "14px", boxShadow: "0 4px 18px rgba(0,0,0,0.08)" }}>
        <h2 style={{ marginTop: 0, marginBottom: "8px", color: "#e91e63" }}>Add Product</h2>
        <p style={{ marginTop: 0, color: "#777" }}>
          Seller price enter kijiye. Customer ko delivery + platform charge + JustBrand Family commission + applicable GST ke baad final price dikhega.
        </p>

        <div style={{
          padding: "13px 15px",
          marginBottom: "20px",
          borderRadius: "10px",
          background: canSell ? "#ecfdf3" : "#fff7ed",
          border: `1px solid ${canSell ? "#a7f3d0" : "#fed7aa"}`,
          color: canSell ? "#047857" : "#9a3412",
          fontWeight: "700",
        }}>
          {!canSell
            ? "🔒 Selling Disabled — KYC, PAN verification and Admin GSTIN approval are all required before product listing."
            : "✓ KYC, PAN and GSTIN approved — You can submit products."}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Product Name *</label>
          <input name="name" value={form.name} onChange={handleChange} placeholder="Example: Men's T-Shirt" style={inputStyle} />

          <label style={labelStyle}>Category *</label>
          <input name="category" value={form.category} onChange={handleChange} placeholder="Example: Fashion" style={inputStyle} list="jb-category-suggestions" />
          <datalist id="jb-category-suggestions">
            {categorySuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <label style={labelStyle}>Subcategory (optional)</label>
          <input
            name="subCategory"
            value={form.subCategory}
            onChange={handleChange}
            placeholder="Example: Shirts"
            style={inputStyle}
          />

          {form.category.trim() ? (
            <div
              role="status"
              style={{
                marginBottom: "14px",
                padding: "10px 12px",
                borderRadius: "10px",
                fontSize: "12.5px",
                fontWeight: 600,
                background: gstSuggestion.suggestion ? "#ecfdf5" : "#fff7ed",
                border: `1px solid ${gstSuggestion.suggestion ? "#a7f3d0" : "#fed7aa"}`,
                color: gstSuggestion.suggestion ? "#065f46" : "#9a3412",
              }}
            >
              {gstSuggestion.loading ? (
                "GST mapping जाँची जा रही है…"
              ) : gstSuggestion.suggestion ? (
                <>
                  ✓ Admin-verified GST mapping: <b>{gstSuggestion.suggestion.gstRate}%</b>
                  {gstSuggestion.suggestion.hsnCode ? ` · HSN ${gstSuggestion.suggestion.hsnCode}` : ""} ·{" "}
                  source: {gstSuggestion.suggestion.level}. यही rate final pricing में लागू होगा।
                </>
              ) : (
                <>
                  ⚠ GST Review Pending — {gstSuggestion.reason || "इस category/HSN के लिए Admin-approved GST mapping नहीं है।"} आपका
                  rate proposal रहेगा और Admin approval तक verified नहीं माना जाएगा।
                </>
              )}
            </div>
          ) : null}

          <label style={labelStyle}>SKU / Product Code</label>
          <input
            name="sku"
            value={form.sku}
            onChange={handleChange}
            placeholder="Example: JB-TSHIRT-001"
            style={inputStyle}
          />

          <label style={labelStyle}>Seller Selling Price (₹) *</label>
          <input type="number" name="price" value={form.price} onChange={handleChange} placeholder="Example: 499" min="0" style={inputStyle} />

          <label style={labelStyle}>MRP / Compare Price</label>
          <input type="number" name="comparePrice" value={form.comparePrice} onChange={handleChange} placeholder="Example: 799" min="0" style={inputStyle} />
          {form.comparePrice !== "" &&
            Number(form.comparePrice) > 0 &&
            Number(form.comparePrice) <= (Number(form.price) || 0) && (
              <p role="status" style={{ margin: "6px 0 0", color: "#9a3412", fontSize: "12.5px" }}>
                MRP should be higher than the selling price — otherwise no
                discount is shown to the buyer.
              </p>
            )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
            <div>
              <label style={labelStyle}>HSN / SAC Code *</label>
              <input name="hsnCode" value={form.hsnCode} onChange={handleChange} placeholder="Enter correct HSN/SAC" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>GST Rate *</label>
              <select
                name="gstRate"
                value={form.gstRate}
                onChange={handleChange}
                style={inputStyle}
                disabled={Boolean(gstSuggestion.suggestion)}
              >
                <option value="">Select GST</option>
                {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}% GST</option>)}
              </select>
              {gstSuggestion.suggestion ? (
                <p style={{ margin: "6px 0 0", fontSize: "11.5px", color: "#065f46" }}>
                  Admin mapping से लिया गया — seller इस rate को override नहीं कर सकता।
                </p>
              ) : null}
            </div>
          </div>

          {/* LIMITED STOCK TRACKING — optional quantity. Blank =
              unlimited (untracked), 0 = out of stock, whole number
              otherwise. Validated here and again on the server. */}
          <label style={labelStyle}>Stock Quantity (blank = unlimited)</label>
          <input
            type="number"
            name="stock"
            value={form.stock}
            onChange={handleChange}
            placeholder="Example: 25 — leave blank for unlimited"
            min="0"
            step="1"
            style={inputStyle}
          />
          {form.stock.trim() !== "" &&
            (!Number.isInteger(Number(form.stock)) || Number(form.stock) < 0) && (
              <p role="status" style={{ margin: "6px 0 0", color: "#9a3412", fontSize: "12.5px" }}>
                Stock must be a whole number of 0 or more. Leave blank for
                unlimited stock.
              </p>
            )}

          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
            <h3 style={{ margin: "0 0 12px" }}>Customer Price Preview</h3>

            {rulesError && !loadingRules && (
              <div role="alert" style={{
                padding: "10px 12px",
                marginBottom: "12px",
                borderRadius: "8px",
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                color: "#9a3412",
                fontSize: "13px",
                fontWeight: "600",
              }}>
                ⚠ Live pricing rules could not be loaded — this preview uses
                the default rules (delivery ₹{rules.deliveryFlat}, platform {rules.platformPercent}%,
                Family commission {rules.mlmPercent}%). The final customer price is always
                recalculated on the server using the admin-configured rules.
              </div>
            )}
            <div style={{ display: "grid", gap: "8px", color: "#555", fontSize: "14px" }}>
              <div>Seller price: <strong>₹{pricing.base.toLocaleString("en-IN")}</strong></div>
              <div>Delivery: <strong>₹{pricing.delivery.toLocaleString("en-IN")}</strong></div>
              <div>Platform charge ({rules.platformPercent}%): <strong>₹{pricing.platform.toFixed(2)}</strong></div>
              <div>JustBrand Family commission ({rules.mlmPercent}%): <strong>₹{pricing.mlm.toFixed(2)}</strong></div>
              <div>GST ({pricing.gst}%): <strong>₹{pricing.gstAmount.toFixed(2)}</strong></div>
              {!gstSuggestion.loading && gstSuggestion.requiresReview ? (
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#9a3412" }}>
                  ⚠ GST Review Pending — Admin verification के बाद final GST लागू होगा।
                </div>
              ) : null}
              <div style={{ borderTop: "1px solid #ddd", paddingTop: "10px", marginTop: "4px", fontSize: "20px", color: "#e91e63" }}>
                Customer pays: <strong>₹{pricing.customerPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>
          </div>

          <ProductImageManager images={images} onChange={setImages} />

          <label style={labelStyle}>Short Details</label>
          <textarea name="shortDetails" value={form.shortDetails} onChange={handleChange} placeholder="Short product details" rows="3" style={inputStyle} />

          <label style={labelStyle}>Description</label>
          <textarea name="description" value={form.description} onChange={handleChange} placeholder="Complete product description" rows="6" style={inputStyle} />

          <button type="submit" disabled={saving || loadingRules || !canSell} style={{
            width: "100%", padding: "14px", border: "none", borderRadius: "8px",
            background: saving || loadingRules || !canSell ? "#999" : "linear-gradient(90deg,#ff7a00,#e91e63)",
            color: "#fff", fontSize: "16px", fontWeight: "700", cursor: saving || !canSell ? "not-allowed" : "pointer",
          }}>
            {!canSell ? "KYC + PAN + GST Approval Required" : saving ? "Submitting..." : "Submit Product"}
          </button>
        </form>
      </div>
    </div>
  );
}

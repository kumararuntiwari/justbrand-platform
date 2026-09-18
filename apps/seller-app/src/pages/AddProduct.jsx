import React, { useEffect, useMemo, useState } from "react";
import "../index.css";

const API_URL = "https://justbrand-in-144629.hostingersite.com";
const GST_RATES = [0, 5, 12, 18, 28, 40];

export default function AddProduct() {
  const [form, setForm] = useState({
    name: "",
    category: "",
    price: "",
    comparePrice: "",
    hsnCode: "",
    gstRate: "",
    image: "",
    description: "",
    shortDetails: "",
  });

  const [rules, setRules] = useState({
    deliveryFlat: 40,
    platformPercent: 5,
    mlmPercent: 3,
  });
  const [kycStatus, setKycStatus] = useState("Pending");
  const [saving, setSaving] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);

  const token = localStorage.getItem("justbrand_seller_token") || "";

  useEffect(() => {
    if (!token) return;

    Promise.all([
      fetch(`${API_URL}/api/sellers/pricing-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/api/sellers/kyc`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([pricingData, kycData]) => {
        if (pricingData?.success && pricingData.rules) {
          setRules(pricingData.rules);
        }
        if (kycData?.success) {
          setKycStatus(kycData.kyc?.kycStatus || "Pending");
        }
      })
      .catch((error) => console.error("Seller pricing/KYC load error:", error))
      .finally(() => setLoadingRules(false));
  }, [token]);

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

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Image 5MB se chhoti honi chahiye.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, image: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (kycStatus !== "Approved") {
      alert("Product submit/approval ke liye pehle Seller KYC Admin se Approved hona chahiye.");
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
          price: form.price.trim(),
          comparePrice: form.comparePrice.trim(),
          hsnCode: form.hsnCode.trim(),
          gstRate: Number(form.gstRate),
          image: form.image || "",
          description: form.description.trim(),
          shortDetails: form.shortDetails.trim(),
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

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Product save failed.");
      }

      alert("Product submit ho gaya. KYC-approved seller ka product admin approval ke baad Buyer App me dikhega.");

      setForm({
        name: "",
        category: "",
        price: "",
        comparePrice: "",
        hsnCode: "",
        gstRate: "",
        image: "",
        description: "",
        shortDetails: "",
      });
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
          background: kycStatus === "Approved" ? "#ecfdf3" : "#fff7ed",
          border: `1px solid ${kycStatus === "Approved" ? "#a7f3d0" : "#fed7aa"}`,
          color: kycStatus === "Approved" ? "#047857" : "#9a3412",
          fontWeight: "700",
        }}>
          {kycStatus === "Approved"
            ? "✓ KYC Approved — You can submit products."
            : "🔒 KYC Approval Required — Product approval is blocked until Admin approves your KYC."}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Product Name *</label>
          <input name="name" value={form.name} onChange={handleChange} placeholder="Example: Men's T-Shirt" style={inputStyle} />

          <label style={labelStyle}>Category *</label>
          <input name="category" value={form.category} onChange={handleChange} placeholder="Example: Fashion" style={inputStyle} />

          <label style={labelStyle}>Seller Selling Price (₹) *</label>
          <input type="number" name="price" value={form.price} onChange={handleChange} placeholder="Example: 499" min="0" style={inputStyle} />

          <label style={labelStyle}>MRP / Compare Price</label>
          <input type="number" name="comparePrice" value={form.comparePrice} onChange={handleChange} placeholder="Example: 799" min="0" style={inputStyle} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
            <div>
              <label style={labelStyle}>HSN / SAC Code *</label>
              <input name="hsnCode" value={form.hsnCode} onChange={handleChange} placeholder="Enter correct HSN/SAC" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>GST Rate *</label>
              <select name="gstRate" value={form.gstRate} onChange={handleChange} style={inputStyle}>
                <option value="">Select GST</option>
                {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}% GST</option>)}
              </select>
            </div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
            <h3 style={{ margin: "0 0 12px" }}>Customer Price Preview</h3>
            <div style={{ display: "grid", gap: "8px", color: "#555", fontSize: "14px" }}>
              <div>Seller price: <strong>₹{pricing.base.toLocaleString("en-IN")}</strong></div>
              <div>Delivery: <strong>₹{pricing.delivery.toLocaleString("en-IN")}</strong></div>
              <div>Platform charge ({rules.platformPercent}%): <strong>₹{pricing.platform.toFixed(2)}</strong></div>
              <div>JustBrand Family commission ({rules.mlmPercent}%): <strong>₹{pricing.mlm.toFixed(2)}</strong></div>
              <div>GST ({pricing.gst}%): <strong>₹{pricing.gstAmount.toFixed(2)}</strong></div>
              <div style={{ borderTop: "1px solid #ddd", paddingTop: "10px", marginTop: "4px", fontSize: "20px", color: "#e91e63" }}>
                Customer pays: <strong>₹{pricing.customerPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>
          </div>

          <label style={labelStyle}>Product Image</label>
          <input type="file" accept="image/*" onChange={handleImageChange} style={inputStyle} />

          {form.image && (
            <div style={{ marginBottom: "20px" }}>
              <p style={{ marginBottom: "8px", fontWeight: "600" }}>Image Preview</p>
              <img src={form.image} alt="Product Preview" style={{ width: "180px", height: "180px", objectFit: "contain", border: "1px solid #ddd", borderRadius: "10px", padding: "5px", background: "#fafafa" }} />
            </div>
          )}

          <label style={labelStyle}>Short Details</label>
          <textarea name="shortDetails" value={form.shortDetails} onChange={handleChange} placeholder="Short product details" rows="3" style={inputStyle} />

          <label style={labelStyle}>Description</label>
          <textarea name="description" value={form.description} onChange={handleChange} placeholder="Complete product description" rows="6" style={inputStyle} />

          <button type="submit" disabled={saving || loadingRules || kycStatus !== "Approved"} style={{
            width: "100%", padding: "14px", border: "none", borderRadius: "8px",
            background: saving || loadingRules || kycStatus !== "Approved" ? "#999" : "linear-gradient(90deg,#ff7a00,#e91e63)",
            color: "#fff", fontSize: "16px", fontWeight: "700", cursor: saving ? "not-allowed" : "pointer",
          }}>
            {kycStatus !== "Approved" ? "KYC Approval Required" : saving ? "Submitting..." : "Submit Product"}
          </button>
        </form>
      </div>
    </div>
  );
}

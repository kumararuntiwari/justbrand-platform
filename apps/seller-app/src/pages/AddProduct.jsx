import React, { useState } from "react";

const API_URL = "https://justbrand.in";

export default function AddProduct() {
  const [form, setForm] = useState({
    name: "",
    category: "",
    price: "",
    comparePrice: "",
    image: "",
    description: "",
    shortDetails: "",
  });

  const [saving, setSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
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

    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        image: reader.result,
      }));
    };

    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) {
      alert("Product name enter kijiye.");
      return;
    }

    if (!form.category.trim()) {
      alert("Category select/enter kijiye.");
      return;
    }

    if (!form.price.trim()) {
      alert("Product price enter kijiye.");
      return;
    }

    setSaving(true);

    try {
      const sellerId =
        localStorage.getItem("sellerId") ||
        localStorage.getItem("seller_id") ||
        `SELLER-${Date.now()}`;

      const sellerName =
        localStorage.getItem("sellerName") ||
        localStorage.getItem("seller_name") ||
        "Seller";

      const response = await fetch(`${API_URL}/api/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sellerId,
          sellerName,

          name: form.name.trim(),
          category: form.category.trim(),
          price: form.price.trim(),
          comparePrice: form.comparePrice.trim(),

          image: form.image || "",

          description: form.description.trim(),
          shortDetails: form.shortDetails.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Product save failed.");
      }

      alert("Product successfully submit ho gaya. Admin approval ke baad Buyer App mein dikhega.");

      setForm({
        name: "",
        category: "",
        price: "",
        comparePrice: "",
        image: "",
        description: "",
        shortDetails: "",
      });
    } catch (error) {
      console.error("Add Product Error:", error);

      alert(
        error.message ||
          "Product save nahi ho paya. Backend server check kijiye."
      );
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
    <div
      style={{
        maxWidth: "800px",
        margin: "30px auto",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "25px",
          borderRadius: "14px",
          boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
        }}
      >
        <h2
          style={{
            marginTop: 0,
            marginBottom: "25px",
            color: "#e91e63",
          }}
        >
          Add Product
        </h2>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Product Name *</label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Example: Men's T-Shirt"
            style={inputStyle}
          />

          <label style={labelStyle}>Category *</label>
          <input
            type="text"
            name="category"
            value={form.category}
            onChange={handleChange}
            placeholder="Example: Fashion"
            style={inputStyle}
          />

          <label style={labelStyle}>Selling Price *</label>
          <input
            type="number"
            name="price"
            value={form.price}
            onChange={handleChange}
            placeholder="Example: 499"
            min="0"
            style={inputStyle}
          />

          <label style={labelStyle}>Compare Price</label>
          <input
            type="number"
            name="comparePrice"
            value={form.comparePrice}
            onChange={handleChange}
            placeholder="Example: 799"
            min="0"
            style={inputStyle}
          />

          <label style={labelStyle}>Product Image</label>

          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            style={inputStyle}
          />

          {form.image && (
            <div style={{ marginBottom: "20px" }}>
              <p
                style={{
                  marginBottom: "8px",
                  fontWeight: "600",
                }}
              >
                Image Preview
              </p>

              <img
                src={form.image}
                alt="Product Preview"
                style={{
                  width: "180px",
                  height: "180px",
                  objectFit: "contain",
                  border: "1px solid #ddd",
                  borderRadius: "10px",
                  padding: "5px",
                  background: "#fafafa",
                }}
              />
            </div>
          )}

          <label style={labelStyle}>Short Details</label>
          <textarea
            name="shortDetails"
            value={form.shortDetails}
            onChange={handleChange}
            placeholder="Short product details"
            rows="3"
            style={inputStyle}
          />

          <label style={labelStyle}>Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            placeholder="Complete product description"
            rows="6"
            style={inputStyle}
          />

          <button
            type="submit"
            disabled={saving}
            style={{
              width: "100%",
              padding: "14px",
              border: "none",
              borderRadius: "8px",
              background: saving
                ? "#999"
                : "linear-gradient(90deg, #ff7a00, #e91e63)",
              color: "#fff",
              fontSize: "16px",
              fontWeight: "700",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Submitting..." : "Submit Product"}
          </button>
        </form>
      </div>
    </div>
  );
}
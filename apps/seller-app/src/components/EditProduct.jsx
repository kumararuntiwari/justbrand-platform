import React, { useState } from "react";
import "../index.css";

const API_URL = "https://justbrand-in-144629.hostingersite.com";

function EditProduct({
  product,
  onBack,
  onSaved,
}) {
  const [form, setForm] = useState({
    name: product.name || "",
    category: product.category || "",
    subCategory: product.subCategory || "",
    brand: product.brand || "",
    price: String(product.price || "").replace("₹", ""),
    mrp: String(product.mrp || "").replace("₹", ""),
    stock: product.stock ?? "",
    sku: product.sku || "",
    weight: product.weight || "",
    shortDetails: product.shortDetails || "",
    description: product.description || "",
  });

  const [image, setImage] = useState(
    product.image || "/images/product1.png"
  );

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

    const reader = new FileReader();

    reader.onload = () => {
      setImage(reader.result);
    };

    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) {
      alert("Please enter Product Name.");
      return;
    }

    if (!form.category) {
      alert("Please select Product Category.");
      return;
    }

    if (!form.price) {
      alert("Please enter Selling Price.");
      return;
    }

    if (form.stock === "") {
      alert("Please enter Stock Quantity.");
      return;
    }

    if (!form.description.trim()) {
      alert("Please enter Product Description.");
      return;
    }

    setSaving(true);

    const updatedProduct = {
      ...product,

      name: form.name.trim(),
      category: form.category,
      subCategory: form.subCategory,
      brand: form.brand,

      price: form.price.startsWith("₹")
        ? form.price
        : `₹${form.price}`,

      mrp: form.mrp
        ? form.mrp.startsWith("₹")
          ? form.mrp
          : `₹${form.mrp}`
        : "",

      stock: Number(form.stock),

      sku: form.sku,
      weight: form.weight,

      shortDetails: form.shortDetails,

      description: form.description,

      image: image || "/images/product1.png",

      updatedAt: new Date().toISOString(),
    };

    try {
      // =====================================
      // BACKEND UPDATE (AUTHENTICATED)
      // =====================================
      // Ownership is verified server-side; edited products go back
      // to Pending until admin re-approves them.

      const token =
        localStorage.getItem("justbrand_seller_token") || "";

      if (!token) {
        alert(
          "Your session has expired. Please login again."
        );
        setSaving(false);
        return;
      }

      const response = await fetch(
        `${API_URL}/api/sellers/products/${product.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: updatedProduct.name,
            category: updatedProduct.category,
            price: String(updatedProduct.price || "").replace("₹", ""),
            comparePrice: String(updatedProduct.mrp || "").replace("₹", ""),
            image: updatedProduct.image,
            description: updatedProduct.description,
            shortDetails: updatedProduct.shortDetails,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(
          data?.message ||
            "Product update failed. Please try again."
        );
        setSaving(false);
        return;
      }

      alert(
        "Product updated and resubmitted for admin approval."
      );

      if (onSaved) {
        onSaved(data.product || updatedProduct);
      }
    } catch (error) {
      console.error(
        "Product update error:",
        error
      );

      alert(
        "Backend से connection नहीं हो रहा. Product update failed."
      );
    }

    setSaving(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
      }}
    >
      {/* HEADER */}

      <header
        style={{
          background:
            "linear-gradient(135deg,#ff6b00,#ff1493)",
          color: "white",
          padding: "15px 25px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "15px",
          flexWrap: "wrap",
        }}
        className="jb-section-header"
      >
        <div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "bold",
            }}
          >
            JustBrand
          </div>

          <div
            style={{
              fontSize: "13px",
              opacity: 0.9,
            }}
          >
            Seller Panel
          </div>
        </div>

        <button
          type="button"
          onClick={onBack}
          style={{
            background: "white",
            color: "#ff1493",
            border: "none",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← My Products
        </button>
      </header>

      {/* MAIN */}

      <main
        style={{
          maxWidth: "1000px",
          margin: "0 auto",
          padding: "25px",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "12px",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <h1 style={{ marginTop: 0 }}>
            ✏️ Edit Product
          </h1>

          <p
            style={{
              color: "#777",
            }}
          >
            Update your product information.
          </p>

          {/* IMAGE */}

          <div
            style={{
              marginTop: "20px",
              marginBottom: "25px",
              textAlign: "center",
            }}
          >
            <img
              src={image}
              alt={form.name}
              onError={(e) => {
                e.currentTarget.src =
                  "/images/product1.png";
              }}
              style={{
                width: "220px",
                height: "180px",
                objectFit: "contain",
                background: "#f5f5f5",
                borderRadius: "10px",
              }}
            />

            <div style={{ marginTop: "12px" }}>
              <label
                style={{
                  display: "inline-block",
                  background: "#ff6b00",
                  color: "white",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                📷 Change Image

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  onChange={handleImageChange}
                  style={{
                    display: "none",
                  }}
                />
              </label>
            </div>
          </div>

          {/* FORM */}

          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(250px,1fr))",
                gap: "16px",
              }}
            >
              <Field
                label="Product Name *"
                name="name"
                value={form.name}
                onChange={handleChange}
              />

              <div>
                <label style={labelStyle}>
                  Category *
                </label>

                <select
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="">
                    Select Category
                  </option>

                  <option value="Electronics">
                    Electronics
                  </option>

                  <option value="Fashion">
                    Fashion
                  </option>

                  <option value="Beauty">
                    Beauty
                  </option>

                  <option value="Home">
                    Home
                  </option>

                  <option value="Grocery">
                    Grocery
                  </option>

                  <option value="Mobiles">
                    Mobiles
                  </option>

                  <option value="Appliances">
                    Appliances
                  </option>

                  <option value="Sports">
                    Sports
                  </option>

                  <option value="Toys">
                    Toys
                  </option>

                  <option value="Other">
                    Other
                  </option>
                </select>
              </div>

              <Field
                label="Sub Category"
                name="subCategory"
                value={form.subCategory}
                onChange={handleChange}
              />

              <Field
                label="Brand"
                name="brand"
                value={form.brand}
                onChange={handleChange}
              />

              <Field
                label="SKU / Product Code"
                name="sku"
                value={form.sku}
                onChange={handleChange}
              />

              <Field
                label="Weight"
                name="weight"
                value={form.weight}
                onChange={handleChange}
              />

              <Field
                label="Selling Price *"
                name="price"
                type="number"
                value={form.price}
                onChange={handleChange}
              />

              <Field
                label="MRP"
                name="mrp"
                type="number"
                value={form.mrp}
                onChange={handleChange}
              />

              <Field
                label="Stock Quantity *"
                name="stock"
                type="number"
                value={form.stock}
                onChange={handleChange}
              />
            </div>

            {/* SHORT DETAILS */}

            <div style={{ marginTop: "20px" }}>
              <label style={labelStyle}>
                Short Details
              </label>

              <input
                name="shortDetails"
                value={form.shortDetails}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Short product details"
              />
            </div>

            {/* DESCRIPTION */}

            <div style={{ marginTop: "20px" }}>
              <label style={labelStyle}>
                Product Description *
              </label>

              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows="7"
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
                placeholder="Describe your product..."
              />
            </div>

            {/* BUTTONS */}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "25px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={onBack}
                style={{
                  padding: "12px 20px",
                  background: "white",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: "12px 24px",
                  background: "#ff6b00",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving
                  ? "Saving..."
                  : "💾 Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
      </label>

      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        style={inputStyle}
      />
    </div>
  );
}

const labelStyle = {
  display: "block",
  marginBottom: "7px",
  fontSize: "14px",
  fontWeight: "bold",
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  border: "1px solid #ccc",
  borderRadius: "8px",
  fontSize: "15px",
  boxSizing: "border-box",
  outline: "none",
  background: "white",
};

export default EditProduct;
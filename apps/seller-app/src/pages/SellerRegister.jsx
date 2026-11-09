import React, { useState } from "react";

import { API_URL } from "../api.js";

function SellerRegister({ onRegister, onLogin }) {
  const [form, setForm] = useState({
    sellerName: "",
    shopName: "",
    mobile: "",
    email: "",
    password: "",
    confirmPassword: "",
    panNumber: "",
    gstNumber: "",
    businessType: "goods",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });

    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (
      !form.sellerName ||
      !form.shopName ||
      !form.mobile ||
      !form.email ||
      !form.password ||
      !form.panNumber ||
      !form.address ||
      !form.state
    ) {
      setError(
        "Name, shop, mobile, email, password, PAN, business address and State are required."
      );
      return;
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.panNumber.toUpperCase())) {
      setError("PAN must be in the format ABCDE1234F.");
      return;
    }

    if (form.password.length < 6) {
      setError(
        "Password must be at least 6 characters."
      );
      return;
    }

    if (
      form.password !==
      form.confirmPassword
    ) {
      setError(
        "Password and Confirm Password do not match."
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Real backend registration — password is hashed server-side
      // and the seller account is stored in the JustBrand database.
      const response = await fetch(
        `${API_URL}/api/sellers/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: form.sellerName,
            shopName: form.shopName,
            mobile: form.mobile,
            email: form.email,
            password: form.password,
            panNumber: form.panNumber.toUpperCase(),
            gstNumber: form.gstNumber.toUpperCase(),
            businessType: form.businessType,
            address: form.address,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(
          data.message ||
            "Registration failed. Please try again."
        );
        return;
      }

      // Registered — send user to Login (same flow as before).
      if (onRegister) {
        onRegister(null);
      }
    } catch (error) {
      console.error(
        "Seller register error:",
        error
      );
      setError(
        "Backend से connection नहीं हो रहा। Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>

      <div style={styles.card}>

        {/* LOGO */}

        <div style={styles.logo}>
          JustBrand
        </div>

        <h1 style={styles.title}>
          Seller Registration
        </h1>

        <p style={styles.subtitle}>
          Create your JustBrand seller
          account
        </p>

        {/* ERROR */}

        {error && (
          <div style={styles.error}>
            ⚠️ {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
        >

          {/* SELLER NAME */}

          <label style={styles.label}>
            Seller Name *
          </label>

          <input
            type="text"
            name="sellerName"
            value={
              form.sellerName
            }
            onChange={
              handleChange
            }
            placeholder="Enter your full name"
            style={styles.input}
          />

          {/* SHOP NAME */}

          <label style={styles.label}>
            Shop / Business Name *
          </label>

          <input
            type="text"
            name="shopName"
            value={
              form.shopName
            }
            onChange={
              handleChange
            }
            placeholder="Enter shop or business name"
            style={styles.input}
          />

          {/* PAN */}

          <label style={styles.label}>
            PAN Number * <span style={styles.hint}>(required — verification is manual)</span>
          </label>

          <input
            type="text"
            name="panNumber"
            value={form.panNumber}
            onChange={(e) =>
              setForm({ ...form, panNumber: e.target.value.toUpperCase() })
            }
            placeholder="ABCDE1234F"
            maxLength={10}
            style={styles.input}
          />

          <label style={styles.label}>
            Business Type *
          </label>

          <select
            name="businessType"
            value={form.businessType}
            onChange={handleChange}
            style={styles.input}
          >
            <option value="goods">Goods (physical products)</option>
            <option value="services">Services (requires GST review)</option>
          </select>

          <label style={styles.label}>
            Business Address *
          </label>

          <textarea
            name="address"
            value={form.address}
            onChange={handleChange}
            placeholder="Complete place of business address"
            rows={3}
            style={{ ...styles.input, resize: "vertical" }}
          />

          <div style={styles.twoCol}>
            <div>
              <label style={styles.label}>City</label>
              <input
                type="text"
                name="city"
                value={form.city}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
            <div>
              <label style={styles.label}>State *</label>
              <input
                type="text"
                name="state"
                value={form.state}
                onChange={handleChange}
                placeholder="e.g. Rajasthan"
                style={styles.input}
              />
            </div>
          </div>

          <label style={styles.label}>PIN Code</label>

          <input
            type="tel"
            name="pincode"
            value={form.pincode}
            onChange={handleChange}
            placeholder="6-digit PIN code"
            maxLength={6}
            style={styles.input}
          />

          <div style={styles.taxNote}>
            PAN is mandatory and stays <b>Pending Verification</b> until a
            JustBrand admin verifies it. GSTIN may be added now or later, but
            <b> product listing and selling stay disabled until KYC, PAN and
            Admin GSTIN approval are complete.</b> GST-unregistered selling is
            not available.
          </div>

          <label style={styles.label}>
            GSTIN <span style={styles.hint}>(optional now — required before selling)</span>
          </label>

          <input
            type="text"
            name="gstNumber"
            value={form.gstNumber}
            onChange={(e) =>
              setForm({ ...form, gstNumber: e.target.value.toUpperCase() })
            }
            placeholder="22AAAAA0000A1Z5"
            maxLength={15}
            style={styles.input}
          />


          {/* MOBILE */}

          <label style={styles.label}>
            Mobile Number *
          </label>

          <input
            type="tel"
            name="mobile"
            value={
              form.mobile
            }
            onChange={
              handleChange
            }
            placeholder="Enter mobile number"
            maxLength={10}
            style={styles.input}
          />

          {/* EMAIL */}

          <label style={styles.label}>
            Email Address *
          </label>

          <input
            type="email"
            name="email"
            value={
              form.email
            }
            onChange={
              handleChange
            }
            placeholder="Enter email address"
            style={styles.input}
          />

          {/* PASSWORD */}

          <label style={styles.label}>
            Password *
          </label>

          <input
            type="password"
            name="password"
            value={
              form.password
            }
            onChange={
              handleChange
            }
            placeholder="Create password"
            style={styles.input}
          />

          {/* CONFIRM PASSWORD */}

          <label style={styles.label}>
            Confirm Password *
          </label>

          <input
            type="password"
            name="confirmPassword"
            value={
              form.confirmPassword
            }
            onChange={
              handleChange
            }
            placeholder="Confirm password"
            style={styles.input}
          />

          {/* REGISTER */}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.registerButton,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? "Creating Account..."
              : "Create Seller Account"}
          </button>

        </form>

        {/* LOGIN */}

        <div style={styles.loginBox}>

          Already have a seller
          account?

          <button
            type="button"
            onClick={onLogin}
            style={styles.loginButton}
          >
            Login
          </button>

        </div>

      </div>

    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg,#fff4ec,#fff0f7)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "560px",
    background: "#fff",
    padding: "30px",
    borderRadius: "16px",
    boxShadow:
      "0 8px 30px rgba(0,0,0,0.10)",
    boxSizing: "border-box",
  },

  logo: {
    textAlign: "center",
    fontSize: "30px",
    fontWeight: "bold",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor:
      "transparent",
  },

  title: {
    textAlign: "center",
    margin:
      "12px 0 5px",
    fontSize: "24px",
  },

  subtitle: {
    textAlign: "center",
    color: "#777",
    margin:
      "0 0 22px",
    fontSize: "14px",
  },

  error: {
    background: "#fff0f0",
    border:
      "1px solid #ffcaca",
    color: "#c62828",
    padding: "10px",
    borderRadius: "8px",
    marginBottom: "15px",
    fontSize: "13px",
  },

  label: {
    display: "block",
    margin:
      "13px 0 6px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#444",
  },

  input: {
    width: "100%",
    padding:
      "12px 13px",
    border:
      "1px solid #d8d8d8",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  },

  hint: {
    color: "#999",
    fontWeight: "400",
    fontSize: "11px",
  },

  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },

  taxNote: {
    marginTop: "14px",
    background: "#fff8e8",
    border: "1px solid #f3dfb0",
    color: "#7a5a10",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "12px",
    lineHeight: 1.5,
  },

  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    marginTop: "14px",
    color: "#555",
    fontSize: "12px",
    lineHeight: 1.4,
  },

  registerButton: {
    width: "100%",
    marginTop: "22px",
    padding: "13px",
    border: "none",
    borderRadius: "9px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: "bold",
    cursor: "pointer",
  },

  loginBox: {
    textAlign: "center",
    marginTop: "20px",
    color: "#777",
    fontSize: "13px",
  },

  loginButton: {
    border: "none",
    background: "transparent",
    color: "#ff1493",
    fontWeight: "bold",
    cursor: "pointer",
    marginLeft: "5px",
  },
};

export default SellerRegister;
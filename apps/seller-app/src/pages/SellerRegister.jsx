import React, { useState } from "react";

function SellerRegister({ onRegister, onLogin }) {
  const [form, setForm] = useState({
    sellerName: "",
    shopName: "",
    mobile: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [error, setError] = useState("");

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });

    setError("");
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (
      !form.sellerName ||
      !form.shopName ||
      !form.mobile ||
      !form.email ||
      !form.password
    ) {
      setError(
        "Please fill all required details."
      );
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

    const sellerData = {
      id:
        "SELLER-" +
        Date.now(),

      sellerName:
        form.sellerName,

      shopName:
        form.shopName,

      mobile:
        form.mobile,

      email:
        form.email,

      password:
        form.password,

      createdAt:
        new Date().toISOString(),

      kycStatus:
        "Pending",
    };

    // Save seller account
    localStorage.setItem(
      "justbrand_seller",
      JSON.stringify(sellerData)
    );

    // ========================================
    // CREATE KYC DATA FROM REGISTRATION
    // ========================================

    const existingKYC =
      localStorage.getItem(
        "justbrand_seller_kyc"
      );

    let kycData = {};

    try {
      kycData = existingKYC
        ? JSON.parse(existingKYC)
        : {};
    } catch {
      kycData = {};
    }

    const updatedKYC = {
      ...kycData,

      sellerName:
        form.sellerName,

      shopName:
        form.shopName,

      mobile:
        form.mobile,

      email:
        form.email,

      updatedAt:
        new Date().toISOString(),
    };

    localStorage.setItem(
      "justbrand_seller_kyc",
      JSON.stringify(updatedKYC)
    );

    // Send seller data to App.jsx
    if (onRegister) {
      onRegister(sellerData);
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
            style={styles.registerButton}
          >
            Create Seller Account
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
    maxWidth: "470px",
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
import React, { useState } from "react";

const API_URL = "https://justbrand-in-144629.hostingersite.com";

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
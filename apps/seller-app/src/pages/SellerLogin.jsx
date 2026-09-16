import React, { useState } from "react";

const API_URL = "https://justbrand-in-144629.hostingersite.com";

function SellerLogin({ onLogin, onRegister }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!loginId.trim()) {
      alert("Please enter Mobile Number or Email.");
      return;
    }

    if (!password) {
      alert("Please enter Password.");
      return;
    }

    setLoading(true);

    try {
      // Backend authentication — password verified server-side,
      // JWT token returned for all authenticated seller API calls.
      const response = await fetch(`${API_URL}/api/sellers/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          loginId: loginId.trim(),
          password: password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(
          data.message ||
            "Seller account not found. Please check your Mobile/Email."
        );
        return;
      }

      const seller = data.seller;

      // Seller identity kept locally for convenience only —
      // real authentication is the backend token.
      localStorage.setItem("sellerId", seller.sellerCode);
      localStorage.setItem("sellerName", seller.name);
      localStorage.setItem("justbrand_seller_token", data.token);
      localStorage.setItem(
        "justbrand_seller_logged_in",
        "true"
      );

      if (onLogin) {
        onLogin(seller);
      }
    } catch (error) {
      console.error("Seller login error:", error);
      alert(
        "Backend से connection नहीं हो रहा। Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* LOGO */}

        <div style={styles.logoArea}>
          <img
            src="/images/logo.png"
            alt="JustBrand"
            style={styles.logo}
            onError={(e) => {
              e.currentTarget.style.display =
                "none";
            }}
          />

          <h1 style={styles.brand}>
            JustBrand
          </h1>

          <p style={styles.subtitle}>
            Seller Login
          </p>
        </div>

        {/* LOGIN FORM */}

        <form onSubmit={handleSubmit}>

          <label style={styles.label}>
            Mobile Number / Email
          </label>

          <input
            type="text"
            value={loginId}
            onChange={(e) =>
              setLoginId(e.target.value)
            }
            placeholder="Enter mobile or email"
            style={styles.input}
          />

          <label style={styles.label}>
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            placeholder="Enter password"
            style={styles.input}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.loginButton,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? "Logging in..."
              : "🔐 Login to Seller Account"}
          </button>

        </form>

        {/* FORGOT PASSWORD */}

        <button
          type="button"
          onClick={() =>
            alert(
              "Forgot Password feature will be connected with backend."
            )
          }
          style={styles.forgotButton}
        >
          Forgot Password?
        </button>

        {/* REGISTER */}

        <div style={styles.registerText}>
          Don't have a seller account?
        </div>

        <button
          type="button"
          onClick={onRegister}
          style={styles.registerButton}
        >
          🏪 Create Seller Account
        </button>

        {/* SECURITY NOTE */}

        <div style={styles.note}>
          🔒 Your seller account is protected with
          secure backend authentication.
        </div>

      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background:
      "linear-gradient(135deg, #fff4e8, #ffe5f0)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "430px",
    background: "#fff",
    padding: "30px",
    borderRadius: "16px",
    boxShadow:
      "0 5px 25px rgba(0,0,0,0.15)",
    boxSizing: "border-box",
  },

  logoArea: {
    textAlign: "center",
    marginBottom: "30px",
  },

  logo: {
    width: "65px",
    height: "65px",
    objectFit: "contain",
    borderRadius: "10px",
    marginBottom: "8px",
  },

  brand: {
    margin: 0,
    color: "#ff6b00",
    fontSize: "30px",
    fontWeight: "bold",
  },

  subtitle: {
    margin: "5px 0 0",
    color: "#777",
    fontSize: "16px",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    marginTop: "15px",
    color: "#333",
    fontSize: "14px",
    fontWeight: "bold",
  },

  input: {
    width: "100%",
    padding: "13px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
  },

  loginButton: {
    width: "100%",
    padding: "14px",
    marginTop: "22px",
    background: "#ff6b00",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
  },

  forgotButton: {
    display: "block",
    margin: "15px auto",
    background: "transparent",
    color: "#ff1493",
    border: "none",
    cursor: "pointer",
    fontSize: "14px",
  },

  registerText: {
    textAlign: "center",
    color: "#666",
    marginTop: "20px",
    marginBottom: "8px",
  },

  registerButton: {
    width: "100%",
    padding: "12px",
    background: "#ff1493",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: "bold",
    cursor: "pointer",
  },

  note: {
    marginTop: "20px",
    padding: "12px",
    background: "#fff8e8",
    borderRadius: "8px",
    color: "#666",
    fontSize: "12px",
    lineHeight: 1.5,
    textAlign: "center",
  },
};

export default SellerLogin;
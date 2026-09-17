import React, { useState } from "react";
import {
  api,
  setCustomerToken,
} from "../api";

function CustomerAuth({ onAuth, onBack }) {
  const [mode, setMode] = useState("login"); // "login" | "register"

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    const cleanMobile = mobile.replace(/\D/g, "");

    if (mode === "register" && !name.trim()) {
      alert("Please enter your full name.");
      return;
    }

    if (!/^\d{10}$/.test(cleanMobile)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }

    if (!password || password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      const data =
        mode === "login"
          ? await api("/api/customers/login", {
              method: "POST",
              body: {
                mobile: cleanMobile,
                password: password,
              },
            })
          : await api("/api/customers/register", {
              method: "POST",
              body: {
                name: name.trim(),
                mobile: cleanMobile,
                email: email.trim(),
                password: password,
                referralCode: referralCode.trim(),
              },
            });

      if (!data.success || !data.token) {
        alert(data.message || "Something went wrong. Please try again.");
        return;
      }

      setCustomerToken(data.token);

      if (onAuth) {
        onAuth(data.customer);
      }
    } catch (error) {
      console.error("Customer auth error:", error);
      alert(error.message || "Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jb-page" style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>My Account</div>
        </div>

        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.card}>
          <div style={styles.iconCircle}>🛍️</div>

          <h1 style={styles.title}>
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </h1>

          <p style={styles.subtitle}>
            {mode === "login"
              ? "Login to track orders and checkout faster."
              : "Register to shop, track orders and earn."}
          </p>

          {/* MODE SWITCH */}
          <div style={styles.modeSwitch}>
            <button
              type="button"
              onClick={() => setMode("login")}
              style={{
                ...styles.modeButton,
                ...(mode === "login" ? styles.modeButtonActive : {}),
              }}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => setMode("register")}
              style={{
                ...styles.modeButton,
                ...(mode === "register" ? styles.modeButtonActive : {}),
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* NAME (REGISTER ONLY) */}
            {mode === "register" && (
              <div style={styles.field}>
                <label style={styles.label}>Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  style={styles.input}
                />
              </div>
            )}

            {/* MOBILE */}
            <div style={styles.field}>
              <label style={styles.label}>Mobile Number</label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="10-digit mobile number"
                maxLength="10"
                autoComplete="username"
                style={styles.input}
              />
            </div>

            {/* EMAIL (REGISTER ONLY) */}
            {mode === "register" && (
              <div style={styles.field}>
                <label style={styles.label}>Email (optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={styles.input}
                />
              </div>
            )}

            {/* PASSWORD */}
            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                style={styles.input}
              />
            </div>

            {/* REFERRAL (REGISTER ONLY) */}
            {mode === "register" && (
              <div style={styles.field}>
                <label style={styles.label}>
                  Referral Code (optional)
                </label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="Member ID or referral code"
                  style={styles.input}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitButton,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                ? "🔐 Login"
                : "📝 Create Account"}
            </button>
          </form>

          <div style={styles.infoBox}>
            <div style={styles.infoText}>
              🔒 Your password is stored securely (hashed) on our servers.
              We never store it in your browser.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "transparent",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  headerText: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  backButton: {
    border: "none",
    background: "#fff",
    color: "#ff1493",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  container: {
    minHeight: "calc(100vh - 70px)",
    width: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "430px",
    background: "#fff",
    borderRadius: "16px",
    padding: "30px",
    boxShadow: "0 5px 25px rgba(0,0,0,0.09)",
    boxSizing: "border-box",
  },

  iconCircle: {
    width: "65px",
    height: "65px",
    margin: "0 auto 12px",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "30px",
  },

  title: {
    margin: 0,
    textAlign: "center",
    fontSize: "26px",
  },

  subtitle: {
    margin: "6px 0 20px",
    textAlign: "center",
    color: "#777",
    fontSize: "14px",
  },

  modeSwitch: {
    display: "flex",
    background: "#f5f5f5",
    borderRadius: "10px",
    padding: "4px",
    marginBottom: "20px",
  },

  modeButton: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: "8px",
    background: "transparent",
    color: "#666",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  },

  modeButtonActive: {
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
  },

  field: {
    marginBottom: "16px",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontSize: "14px",
    fontWeight: "bold",
    color: "#333",
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

  submitButton: {
    width: "100%",
    padding: "13px",
    border: "none",
    borderRadius: "8px",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "bold",
    marginTop: "5px",
  },

  infoBox: {
    marginTop: "20px",
    padding: "12px",
    background: "#eef7ff",
    borderRadius: "8px",
  },

  infoText: {
    fontSize: "12px",
    color: "#666",
    lineHeight: 1.5,
  },
};

export default CustomerAuth;

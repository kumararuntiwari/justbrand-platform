import React, { useState } from "react";
import {
  API_URL,
  setMlmToken,
} from "../api";

function MLMLogin({ onLogin, onRegister, onBack }) {
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ==========================================
  // LOGIN
  // ==========================================

  async function handleSubmit(e) {
    e.preventDefault();

    if (!memberId.trim()) {
      alert("Please enter Member ID.");
      return;
    }

    if (!password) {
      alert("Please enter Password.");
      return;
    }

    setLoading(true);

    try {
      // Backend authentication — credentials verified server-side,
      // nothing about the password is stored in the browser.
      const response = await fetch(`${API_URL}/api/mlm/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberId: memberId.trim(),
          password: password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(
          data.message ||
            "Member ID not found or incorrect password."
        );
        return;
      }

      const member = data.member;

      setMlmToken(data.token);

      localStorage.setItem(
        "justbrand_mlm_member",
        JSON.stringify(member)
      );

      if (onLogin) {
        onLogin(member);
      }
    } catch (error) {
      console.error(
        "MLM login error:",
        error
      );

      alert(
        "Backend से connection नहीं हो रहा। Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // PAGE
  // ==========================================

  return (
    <div className="jb-page" style={styles.page}>
      <div className="jb-family-chakra" aria-hidden="true" />

      {/* ======================================
          HEADER
      ====================================== */}

      <header style={styles.header}>

        <div>

          <div style={styles.logo}>
            JustBrand
          </div>

          <div style={styles.headerText}>
            JustBrand Family
          </div>

        </div>

        <button
          type="button"
          onClick={onBack}
          style={styles.backButton}
        >
          ← Back
        </button>

      </header>

      {/* ======================================
          LOGIN CONTAINER
      ====================================== */}

      <main style={styles.container}>

        <div style={styles.card}>

          {/* ICON */}

          <div style={styles.iconCircle}>
            👥
          </div>

          <h1 style={styles.title}>
            JustBrand Family
          </h1>

          <p style={styles.subtitle}>
            Member Login
          </p>

          {/* ==================================
              FORM
          ================================== */}

          <form onSubmit={handleSubmit}>

            {/* MEMBER ID */}

            <div style={styles.field}>

              <label style={styles.label}>
                Member ID
              </label>

              <input
                type="text"
                value={memberId}
                onChange={(e) =>
                  setMemberId(
                    e.target.value
                  )
                }
                placeholder="Example: JB123456"
                autoComplete="username"
                style={styles.input}
              />

            </div>

            {/* PASSWORD */}

            <div style={styles.field}>

              <label style={styles.label}>
                Password
              </label>

              <div style={styles.passwordBox}>

                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  style={
                    styles.passwordInput
                  }
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (prev) => !prev
                    )
                  }
                  style={
                    styles.showButton
                  }
                >
                  {showPassword
                    ? "Hide"
                    : "Show"}
                </button>

              </div>

            </div>

            {/* LOGIN BUTTON */}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.loginButton,
                opacity: loading
                  ? 0.7
                  : 1,
              }}
            >
              {loading
                ? "Logging in..."
                : "🔐 Login"}
            </button>

          </form>

          {/* ==================================
              REGISTER
          ================================== */}

          <div style={styles.registerBox}>

            <div style={styles.registerText}>
              Don't have a JustBrand Member
              Account?
            </div>

            <button
              type="button"
              onClick={onRegister}
              style={styles.registerButton}
            >
              Create New Member Account
            </button>

          </div>

          {/* ==================================
              INFO
          ================================== */}

          <div style={styles.infoBox}>

            <div style={styles.infoTitle}>
              ℹ️ Member Login
            </div>

            <div style={styles.infoText}>
              Use your JustBrand Member ID and
              password to access your Family
              Dashboard.
            </div>

          </div>

        </div>

      </main>

    </div>
  );
}


/* ==========================================
   STYLES
========================================== */

const styles = {

  page: {
    minHeight: "100vh",
    background:
      "transparent",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
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
    minHeight:
      "calc(100vh - 70px)",
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
    boxShadow:
      "0 5px 25px rgba(0,0,0,0.09)",
    boxSizing: "border-box",
  },

  iconCircle: {
    width: "65px",
    height: "65px",
    margin: "0 auto 12px",
    borderRadius: "50%",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "30px",
  },

  title: {
    margin: 0,
    textAlign: "center",
    fontSize: "27px",
  },

  subtitle: {
    margin:
      "6px 0 25px",
    textAlign: "center",
    color: "#777",
    fontSize: "14px",
  },

  field: {
    marginBottom: "18px",
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

  passwordBox: {
    width: "100%",
    display: "flex",
    border: "1px solid #ccc",
    borderRadius: "8px",
    overflow: "hidden",
    boxSizing: "border-box",
    background: "#fff",
  },

  passwordInput: {
    flex: 1,
    minWidth: 0,
    padding: "13px",
    border: "none",
    outline: "none",
    fontSize: "15px",
    boxSizing: "border-box",
  },

  showButton: {
    border: "none",
    background: "#f7f7f7",
    color: "#ff1493",
    padding: "0 13px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  loginButton: {
    width: "100%",
    padding: "13px",
    border: "none",
    borderRadius: "8px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "bold",
    marginTop: "5px",
  },

  registerBox: {
    marginTop: "22px",
    paddingTop: "20px",
    borderTop: "1px solid #eee",
    textAlign: "center",
  },

  registerText: {
    color: "#777",
    fontSize: "13px",
  },

  registerButton: {
    marginTop: "10px",
    padding: "10px 15px",
    border: "1px solid #ff1493",
    background: "#fff0f5",
    color: "#ff1493",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  infoBox: {
    marginTop: "22px",
    padding: "12px",
    background: "#eef7ff",
    borderRadius: "8px",
  },

  infoTitle: {
    fontWeight: "bold",
    fontSize: "13px",
    color: "#444",
  },

  infoText: {
    marginTop: "5px",
    fontSize: "12px",
    color: "#666",
    lineHeight: 1.5,
  },
};

export default MLMLogin;
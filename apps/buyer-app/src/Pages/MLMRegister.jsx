import React, { useState } from "react";
import {
  API_URL,
  setMlmToken,
} from "../api";

function MLMRegister({ onBack, onRegistered }) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    password: "",
    referralCode: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }



  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setMessage("");

    const name =
      form.name.trim();

    const mobile =
      form.mobile.trim();

    const email =
      form.email.trim();

    const password =
      form.password.trim();

    const referralCode =
      form.referralCode.trim();

    // ========================================
    // VALIDATION
    // ========================================

    if (!name) {
      setError(
        "Please enter member name."
      );
      return;
    }

    if (!mobile) {
      setError(
        "Please enter mobile number."
      );
      return;
    }

    if (!password) {
      setError(
        "Please create a password."
      );
      return;
    }

    // ========================================
    // BACKEND REGISTRATION
    // ========================================
    // Member ID, A/B/C placement and spillover are decided by the
    // backend; the password is hashed server-side and never stored
    // in the browser.

    setLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/mlm/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            mobile,
            email,
            password,
            referralCode,
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

      const newMember = data.member;

      // Auth token for future MLM API calls.
      setMlmToken(data.token);

      // Keep the local member cache for instant UI rendering.
      localStorage.setItem(
        "justbrand_mlm_member",
        JSON.stringify(newMember)
      );

      setMessage(
        `Registration successful! Member ID: ${newMember.memberId} | Position: ${newMember.position || "ROOT"}`
      );

      // ========================================
      // RESET FORM
      // ========================================

      setForm({
        name: "",
        mobile: "",
        email: "",
        password: "",
        referralCode: "",
      });

      // ========================================
      // CALLBACK
      // ========================================

      if (onRegistered) {
        onRegistered(newMember);
      }
    } catch (error) {
      console.error(
        "MLM register error:",
        error
      );
      setError(
        "Backend से connection नहीं हो रहा। Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="jb-page" style={styles.page}>
      <div className="jb-family-chakra" aria-hidden="true" />
      <div style={styles.card}>

        {/* HEADER */}

        <div style={styles.header}>

          <div style={styles.logo}>
            JustBrand
          </div>

          <div
            style={
              styles.headerText
            }
          >
            Family Registration
          </div>

        </div>

        {/* TITLE */}

        <h1 style={styles.title}>
          📝 Create Family Account
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          JustBrand Family में नया
          member register करें।
        </p>

        {/* A B C STRUCTURE */}

        <div
          style={
            styles.structureBox
          }
        >

          <div
            style={
              styles.structureTitle
            }
          >
            🌳 A / B / C Team Structure
          </div>

          <div
            style={
              styles.structure
            }
          >

            {/* A */}

            <div
              style={
                styles.positionBox
              }
            >

              <div
                style={
                  styles.positionIcon
                }
              >
                🅰️
              </div>

              <div
                style={
                  styles.positionName
                }
              >
                A
              </div>

            </div>

            {/* B */}

            <div
              style={
                styles.positionBox
              }
            >

              <div
                style={
                  styles.positionIcon
                }
              >
                🅱️
              </div>

              <div
                style={
                  styles.positionName
                }
              >
                B
              </div>

            </div>

            {/* C */}

            <div
              style={
                styles.positionBox
              }
            >

              <div
                style={
                  styles.positionIcon
                }
              >
                ©️
              </div>

              <div
                style={
                  styles.positionName
                }
              >
                C
              </div>

            </div>

          </div>

          <div
            style={
              styles.structureText
            }
          >
            New members will be placed
            automatically in A, B or C.
          </div>

        </div>

        {/* ERROR */}

        {error && (
          <div
            style={
              styles.error
            }
          >
            ❌ {error}
          </div>
        )}

        {/* SUCCESS */}

        {message && (
          <div
            style={
              styles.success
            }
          >
            ✅ {message}
          </div>
        )}

        {/* FORM */}

        <form
          onSubmit={
            handleSubmit
          }
        >

          {/* NAME */}

          <label
            style={
              styles.label
            }
          >
            Full Name
          </label>

          <input
            type="text"
            name="name"
            value={
              form.name
            }
            onChange={
              handleChange
            }
            placeholder="Enter full name"
            style={
              styles.input
            }
          />

          {/* MOBILE */}

          <label
            style={
              styles.label
            }
          >
            Mobile Number
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
            style={
              styles.input
            }
          />

          {/* EMAIL */}

          <label
            style={
              styles.label
            }
          >
            Email
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
            placeholder="Enter email"
            style={
              styles.input
            }
          />

          {/* PASSWORD */}

          <label
            style={
              styles.label
            }
          >
            Password
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
            style={
              styles.input
            }
          />

          {/* REFERRAL */}

          <label
            style={
              styles.label
            }
          >
            Referral Code
          </label>

          <input
            type="text"
            name="referralCode"
            value={
              form.referralCode
            }
            onChange={
              handleChange
            }
            placeholder="Enter referral code"
            style={
              styles.input
            }
          />

          {/* REGISTER */}          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.registerButton,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? "Registering..."
              : "🚀 Register Member"}
          </button>

        </form>

        {/* BACK */}

        <button
          type="button"
          onClick={
            onBack
          }
          style={
            styles.backButton
          }
        >
          ← Back
        </button>

      </div>
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles = {
  page: {
    minHeight: "100vh",
    padding: "30px 15px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "520px",
    margin: "20px auto",
    background: "#ffffff",
    padding: "25px",
    borderRadius: "15px",
    boxSizing: "border-box",
    boxShadow:
      "0 4px 15px rgba(0,0,0,0.08)",
  },

  header: {
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#ffffff",
    padding: "18px",
    borderRadius: "12px",
    textAlign: "center",
    marginBottom: "22px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  headerText: {
    marginTop: "4px",
    fontSize: "13px",
  },

  title: {
    margin: 0,
    fontSize: "24px",
    color: "#222",
  },

  subtitle: {
    color: "#777",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  structureBox: {
    marginTop: "20px",
    padding: "15px",
    background: "#fff8f5",
    border:
      "1px solid #ffe2d0",
    borderRadius: "12px",
  },

  structureTitle: {
    textAlign: "center",
    fontSize: "14px",
    fontWeight: "bold",
    color: "#ff1493",
  },

  structure: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3,1fr)",
    gap: "8px",
    marginTop: "12px",
  },

  positionBox: {
    background: "#ffffff",
    border:
      "1px solid #eeeeee",
    borderRadius: "9px",
    padding: "10px 5px",
    textAlign: "center",
  },

  positionIcon: {
    fontSize: "22px",
  },

  positionName: {
    marginTop: "4px",
    fontSize: "14px",
    fontWeight: "bold",
    color: "#555",
  },

  structureText: {
    marginTop: "10px",
    textAlign: "center",
    fontSize: "11px",
    color: "#888",
  },

  error: {
    marginTop: "15px",
    padding: "12px",
    borderRadius: "8px",
    background: "#fff0f0",
    color: "#dc3545",
    fontSize: "12px",
  },

  success: {
    marginTop: "15px",
    padding: "12px",
    borderRadius: "8px",
    background: "#e9fff1",
    color: "#198754",
    fontSize: "12px",
  },

  label: {
    display: "block",
    marginTop: "15px",
    marginBottom: "6px",
    fontSize: "12px",
    fontWeight: "bold",
    color: "#444",
  },

  input: {
    width: "100%",
    padding: "12px",
    boxSizing: "border-box",
    border:
      "1px solid #ddd",
    borderRadius: "8px",
    outline: "none",
    fontSize: "13px",
  },

  registerButton: {
    width: "100%",
    marginTop: "22px",
    padding: "13px",
    border: "none",
    borderRadius: "9px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#ffffff",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "14px",
  },

  backButton: {
    width: "100%",
    marginTop: "12px",
    padding: "11px",
    border:
      "1px solid #ddd",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#555",
    fontWeight: "bold",
    cursor: "pointer",
  },
};

export default MLMRegister;
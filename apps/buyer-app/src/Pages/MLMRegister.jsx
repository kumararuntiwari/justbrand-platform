import React, { useState } from "react";

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

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  // ==========================================
  // GENERATE MEMBER ID
  // ==========================================

  function generateMemberId() {
    const number = Math.floor(
      100000 + Math.random() * 900000
    );

    return `JB${number}`;
  }

  // ==========================================
  // MEMBERS
  // ==========================================

  function getMembers() {
    try {
      const saved = localStorage.getItem(
        "justbrand_mlm_members"
      );

      if (!saved) return [];

      const data = JSON.parse(saved);

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.log(
        "Members loading error:",
        error
      );

      return [];
    }
  }

  function saveMembers(members) {
    localStorage.setItem(
      "justbrand_mlm_members",
      JSON.stringify(members)
    );
  }

  // ==========================================
  // CURRENT MEMBER
  // ==========================================

  function getCurrentMember() {
    try {
      const saved = localStorage.getItem(
        "justbrand_mlm_member"
      );

      if (!saved) return null;

      return JSON.parse(saved);
    } catch {
      return null;
    }
  }

  // ==========================================
  // TEAM STORAGE
  // ==========================================

  function getTeam(key) {
    try {
      const saved =
        localStorage.getItem(key);

      if (!saved) return [];

      const data = JSON.parse(saved);

      return Array.isArray(data)
        ? data
        : [];
    } catch {
      return [];
    }
  }

  function saveTeam(key, team) {
    localStorage.setItem(
      key,
      JSON.stringify(team)
    );
  }

  // ==========================================
  // FIND A / B / C POSITION
  // ==========================================

  function findPlacement() {
    const teamA = getTeam(
      "justbrand_mlm_a_team"
    );

    const teamB = getTeam(
      "justbrand_mlm_b_team"
    );

    const teamC = getTeam(
      "justbrand_mlm_c_team"
    );

    if (teamA.length === 0) {
      return "A";
    }

    if (teamB.length === 0) {
      return "B";
    }

    if (teamC.length === 0) {
      return "C";
    }

    // अगर A, B, C तीनों भरे हैं
    // तो अगला member A में जाएगा
    return "A";
  }

  // ==========================================
  // ADD MEMBER TO A / B / C TEAM
  // ==========================================

  function addMemberToTeam(
    newMember,
    position
  ) {
    if (position === "A") {
      const team =
        getTeam(
          "justbrand_mlm_a_team"
        );

      team.push(newMember);

      saveTeam(
        "justbrand_mlm_a_team",
        team
      );

      return;
    }

    if (position === "B") {
      const team =
        getTeam(
          "justbrand_mlm_b_team"
        );

      team.push(newMember);

      saveTeam(
        "justbrand_mlm_b_team",
        team
      );

      return;
    }

    if (position === "C") {
      const team =
        getTeam(
          "justbrand_mlm_c_team"
        );

      team.push(newMember);

      saveTeam(
        "justbrand_mlm_c_team",
        team
      );
    }
  }

  // ==========================================
  // REGISTER
  // ==========================================

  function handleSubmit(e) {
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
    // CHECK EXISTING MEMBER
    // ========================================

    const members =
      getMembers();

    const alreadyExists =
      members.some(
        (item) =>
          String(
            item.mobile || ""
          ) === mobile
      );

    if (alreadyExists) {
      setError(
        "This mobile number is already registered."
      );
      return;
    }

    // ========================================
    // PARENT
    // ========================================

    const parent =
      getCurrentMember();

    // ========================================
    // MEMBER ID
    // ========================================

    const memberId =
      generateMemberId();

    // ========================================
    // FIND POSITION
    // ========================================

    const position =
      findPlacement();

    // ========================================
    // NEW MEMBER
    // ========================================

    const newMember = {
      id: memberId,

      memberId: memberId,

      name: name,

      mobile: mobile,

      email: email,

      password: password,

      referralCode:
        referralCode ||
        memberId,

      parentId:
        parent?.memberId ||
        parent?.id ||
        null,

      position: position,

      createdAt:
        new Date().toISOString(),
    };

    // ========================================
    // SAVE TEAM
    // ========================================

    addMemberToTeam(
      newMember,
      position
    );

    // ========================================
    // SAVE MEMBERS
    // ========================================

    members.push(
      newMember
    );

    saveMembers(
      members
    );

    // ========================================
    // CURRENT MEMBER
    // ========================================

    localStorage.setItem(
      "justbrand_mlm_member",
      JSON.stringify(
        newMember
      )
    );

    // ========================================
    // SUCCESS MESSAGE
    // ========================================

    setMessage(
      `Registration successful! Member ID: ${memberId} | Position: ${position}`
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
      onRegistered(
        newMember
      );
    }
  }

  // ==========================================
  // UI
  // ==========================================

  return (
    <div style={styles.page}>
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
            MLM Registration
          </div>

        </div>

        {/* TITLE */}

        <h1 style={styles.title}>
          📝 Create MLM Account
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          JustBrand Family में नया MLM
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

          {/* REGISTER */}

          <button
            type="submit"
            style={
              styles.registerButton
            }
          >
            🚀 Register Member
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
    background: "#f5f5f5",
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
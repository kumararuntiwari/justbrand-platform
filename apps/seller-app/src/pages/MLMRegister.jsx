import React, { useState } from "react";

function MLMRegister({ onBack, onRegistered, onLogin }) {
  const [form, setForm] = useState({
    sponsorId: "",
    memberName: "",
    mobile: "",
    email: "",
    password: "",
    confirmPassword: "",
    placement: "left",
  });

  const [saving, setSaving] = useState(false);

  // ==========================================
  // INPUT CHANGE
  // ==========================================

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
    const random = Math.floor(
      100000 + Math.random() * 900000
    );

    return `JB${random}`;
  }

  // ==========================================
  // SAVE REGISTRATION
  // ==========================================

  function handleSubmit(e) {
    e.preventDefault();

    if (!form.memberName.trim()) {
      alert("Please enter Member Name.");
      return;
    }

    if (!form.mobile.trim()) {
      alert("Please enter Mobile Number.");
      return;
    }

    if (form.mobile.length !== 10) {
      alert("Please enter a valid 10 digit Mobile Number.");
      return;
    }

    if (!form.password) {
      alert("Please enter Password.");
      return;
    }

    if (form.password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      alert("Password and Confirm Password do not match.");
      return;
    }

    setSaving(true);

    try {
      // ======================================
      // GET EXISTING MEMBERS
      // ======================================

      const savedMembers =
        localStorage.getItem("justbrand_mlm_members");

      let members = [];

      if (savedMembers) {
        try {
          const parsed = JSON.parse(savedMembers);

          if (Array.isArray(parsed)) {
            members = parsed;
          }
        } catch {
          members = [];
        }
      }

      // ======================================
      // CHECK DUPLICATE MOBILE
      // ======================================

      const mobileExists = members.some(
        (member) =>
          String(member.mobile) ===
          String(form.mobile)
      );

      if (mobileExists) {
        alert(
          "This mobile number is already registered."
        );

        setSaving(false);
        return;
      }

      // ======================================
      // CREATE MEMBER ID
      // ======================================

      let memberId = generateMemberId();

      while (
        members.some(
          (member) =>
            member.memberId === memberId
        )
      ) {
        memberId = generateMemberId();
      }

      // ======================================
      // CREATE MEMBER
      // ======================================

      const newMember = {
        id: Date.now(),

        memberId: memberId,

        sponsorId:
          form.sponsorId.trim() || "ADMIN",

        memberName:
          form.memberName.trim(),

        mobile:
          form.mobile.trim(),

        email:
          form.email.trim(),

        password:
          form.password,

        placement:
          form.placement,

        leftMemberId: "",

        centerMemberId: "",

        rightMemberId: "",

        status: "Active",

        walletBalance: 0,

        referralIncome: 0,

        binaryIncome: 0,

        totalIncome: 0,

        joiningDate:
          new Date().toISOString(),

        createdAt:
          new Date().toISOString(),
      };

      // ======================================
      // ADD MEMBER
      // ======================================

      members.push(newMember);

      localStorage.setItem(
        "justbrand_mlm_members",
        JSON.stringify(members)
      );

      // ======================================
      // SAVE CURRENT MEMBER
      // ======================================

      localStorage.setItem(
        "justbrand_mlm_current_member",
        JSON.stringify(newMember)
      );

      // ======================================
      // SAVE LOGIN STATUS
      // ======================================

      localStorage.setItem(
        "justbrand_mlm_logged_in",
        "true"
      );

      // ======================================
      // SUCCESS
      // ======================================

      alert(
        `Registration Successful!\n\nYour JustBrand Member ID is:\n${memberId}`
      );

      setSaving(false);

      if (onRegistered) {
        onRegistered(newMember);
      }
    } catch (error) {
      console.error(
        "MLM registration error:",
        error
      );

      alert(
        "Registration failed. Please try again."
      );

      setSaving(false);
    }
  }

  // ==========================================
  // PAGE
  // ==========================================

  return (
    <div style={styles.page}>

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
          MAIN
      ====================================== */}

      <main style={styles.container}>

        <div style={styles.card}>

          {/* TITLE */}

          <div style={styles.titleArea}>

            <div style={styles.iconCircle}>
              👥
            </div>

            <h1 style={styles.title}>
              Join JustBrand Family
            </h1>

            <p style={styles.subtitle}>
              Create your JustBrand MLM Member
              Account
            </p>

          </div>

          {/* INFO */}

          <div style={styles.infoBox}>
            ℹ️ Your Member ID will be generated
            automatically after registration.
          </div>

          {/* FORM */}

          <form onSubmit={handleSubmit}>

            {/* ==================================
                SPONSOR
            ================================== */}

            <div style={styles.sectionTitle}>
              🔗 Sponsor & Placement
            </div>

            <div style={styles.field}>

              <label style={styles.label}>
                Sponsor / Referral ID
              </label>

              <input
                type="text"
                name="sponsorId"
                value={form.sponsorId}
                onChange={handleChange}
                placeholder="Example: JB100001"
                style={styles.input}
              />

              <div style={styles.helper}>
                If you were referred by an existing
                member, enter their Member ID.
              </div>

            </div>

            {/* PLACEMENT */}

            <div style={styles.field}>

              <label style={styles.label}>
                Placement
              </label>

              <div style={styles.placementGrid}>

                <PlacementButton
                  value="left"
                  label="Left"
                  icon="⬅️"
                  selected={
                    form.placement === "left"
                  }
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      placement: "left",
                    }))
                  }
                />

                <PlacementButton
                  value="center"
                  label="Center"
                  icon="⬇️"
                  selected={
                    form.placement === "center"
                  }
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      placement: "center",
                    }))
                  }
                />

                <PlacementButton
                  value="right"
                  label="Right"
                  icon="➡️"
                  selected={
                    form.placement === "right"
                  }
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      placement: "right",
                    }))
                  }
                />

              </div>

            </div>

            {/* ==================================
                MEMBER DETAILS
            ================================== */}

            <div style={styles.sectionTitle}>
              👤 Member Details
            </div>

            <div style={styles.field}>

              <label style={styles.label}>
                Full Name *
              </label>

              <input
                type="text"
                name="memberName"
                value={form.memberName}
                onChange={handleChange}
                placeholder="Enter your full name"
                style={styles.input}
              />

            </div>

            <div style={styles.grid}>

              <div style={styles.field}>

                <label style={styles.label}>
                  Mobile Number *
                </label>

                <input
                  type="tel"
                  name="mobile"
                  value={form.mobile}
                  onChange={(e) => {
                    const value =
                      e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 10);

                    setForm((prev) => ({
                      ...prev,
                      mobile: value,
                    }));
                  }}
                  placeholder="10 digit mobile"
                  style={styles.input}
                />

              </div>

              <div style={styles.field}>

                <label style={styles.label}>
                  Email
                </label>

                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="Enter email address"
                  style={styles.input}
                />

              </div>

            </div>

            {/* ==================================
                PASSWORD
            ================================== */}

            <div style={styles.sectionTitle}>
              🔐 Account Security
            </div>

            <div style={styles.grid}>

              <div style={styles.field}>

                <label style={styles.label}>
                  Password *
                </label>

                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Minimum 6 characters"
                  style={styles.input}
                />

              </div>

              <div style={styles.field}>

                <label style={styles.label}>
                  Confirm Password *
                </label>

                <input
                  type="password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Enter password again"
                  style={styles.input}
                />

              </div>

            </div>

            {/* ==================================
                TERMS
            ================================== */}

            <div style={styles.termsBox}>

              <span style={styles.checkIcon}>
                ✓
              </span>

              <span>
                By registering, you agree to the
                JustBrand terms and conditions.
              </span>

            </div>

            {/* ==================================
                BUTTONS
            ================================== */}

            <div style={styles.buttonArea}>

              <button
                type="button"
                onClick={onBack}
                style={styles.cancelButton}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                style={{
                  ...styles.registerButton,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving
                  ? "Creating Account..."
                  : "✅ Create Member Account"}
              </button>

            </div>

          </form>

          {/* LOGIN */}

          <div style={styles.loginBox}>

            Already have a JustBrand Member
            Account?

            <button
              type="button"
              onClick={onLogin}
              style={styles.loginButton}
            >
              Login
            </button>

          </div>

        </div>

      </main>

    </div>
  );
}


/* ==========================================
   PLACEMENT BUTTON
========================================== */

function PlacementButton({
  label,
  icon,
  selected,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.placementButton,
        background: selected
          ? "#fff0f5"
          : "#fff",
        border: selected
          ? "2px solid #ff1493"
          : "1px solid #ddd",
        color: selected
          ? "#ff1493"
          : "#555",
      }}
    >

      <div style={styles.placementIcon}>
        {icon}
      </div>

      <div style={styles.placementLabel}>
        {label}
      </div>

      {selected && (
        <div style={styles.selectedText}>
          Selected
        </div>
      )}

    </button>
  );
}


/* ==========================================
   STYLES
========================================== */

const styles = {

  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg,#fff7f2,#fff0f7)",
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
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  card: {
    background: "#fff",
    borderRadius: "16px",
    padding: "28px",
    boxShadow:
      "0 4px 20px rgba(0,0,0,0.08)",
    boxSizing: "border-box",
  },

  titleArea: {
    textAlign: "center",
    marginBottom: "20px",
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
    fontSize: "27px",
  },

  subtitle: {
    margin: "7px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  infoBox: {
    background: "#eef7ff",
    color: "#555",
    padding: "12px",
    borderRadius: "8px",
    fontSize: "13px",
    marginBottom: "22px",
    lineHeight: 1.5,
  },

  sectionTitle: {
    fontSize: "17px",
    fontWeight: "bold",
    marginTop: "24px",
    marginBottom: "15px",
    paddingBottom: "9px",
    borderBottom: "2px solid #eee",
  },

  field: {
    width: "100%",
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
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    background: "#fff",
  },

  helper: {
    marginTop: "5px",
    color: "#999",
    fontSize: "11px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(240px,1fr))",
    gap: "15px",
  },

  placementGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3,1fr)",
    gap: "10px",
  },

  placementButton: {
    minHeight: "90px",
    borderRadius: "10px",
    cursor: "pointer",
    padding: "10px",
    textAlign: "center",
    boxSizing: "border-box",
  },

  placementIcon: {
    fontSize: "22px",
  },

  placementLabel: {
    marginTop: "5px",
    fontWeight: "bold",
    fontSize: "14px",
  },

  selectedText: {
    marginTop: "3px",
    fontSize: "10px",
    fontWeight: "bold",
  },

  termsBox: {
    marginTop: "10px",
    padding: "12px",
    background: "#f8f8f8",
    borderRadius: "8px",
    color: "#666",
    fontSize: "12px",
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },

  checkIcon: {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    background: "#28a745",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontWeight: "bold",
  },

  buttonArea: {
    marginTop: "25px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  cancelButton: {
    padding: "12px 20px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#555",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  registerButton: {
    padding: "12px 20px",
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  },

  loginBox: {
    marginTop: "22px",
    paddingTop: "18px",
    borderTop: "1px solid #eee",
    textAlign: "center",
    color: "#777",
    fontSize: "13px",
  },

  loginButton: {
    marginLeft: "7px",
    border: "none",
    background: "transparent",
    color: "#ff1493",
    cursor: "pointer",
    fontWeight: "bold",
  },
};

export default MLMRegister;
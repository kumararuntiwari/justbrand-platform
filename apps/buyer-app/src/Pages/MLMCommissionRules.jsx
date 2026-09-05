import React, { useEffect, useState } from "react";

function MLMCommissionRules() {
  const [rules, setRules] = useState(() => {
    try {
      const saved = localStorage.getItem(
        "justbrand_mlm_commission_rules"
      );

      return saved
        ? JSON.parse(saved)
        : {
            directCommission: 10,
            levelCommission: 5,
            binaryCommission: 5,
            shoppingCommission: 3,
            returnPeriodDays: 7,
            directMemberLimit: 3,
            commissionAfterReturn: true,
            cancelCommission: false,
            returnCommission: false,
          };
    } catch {
      return {
        directCommission: 10,
        levelCommission: 5,
        binaryCommission: 5,
        shoppingCommission: 3,
        returnPeriodDays: 7,
        directMemberLimit: 3,
        commissionAfterReturn: true,
        cancelCommission: false,
        returnCommission: false,
      };
    }
  });

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    localStorage.setItem(
      "justbrand_mlm_commission_rules",
      JSON.stringify(rules)
    );
  }, [rules]);

  function updateRule(key, value) {
    setRules((old) => ({
      ...old,
      [key]: value,
    }));

    setSaved(false);
  }

  function saveRules() {
    localStorage.setItem(
      "justbrand_mlm_commission_rules",
      JSON.stringify(rules)
    );

    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 2500);
  }

  function resetRules() {
    const defaultRules = {
      directCommission: 10,
      levelCommission: 5,
      binaryCommission: 5,
      shoppingCommission: 3,
      returnPeriodDays: 7,
      directMemberLimit: 3,
      commissionAfterReturn: true,
      cancelCommission: false,
      returnCommission: false,
    };

    setRules(defaultRules);

    localStorage.setItem(
      "justbrand_mlm_commission_rules",
      JSON.stringify(defaultRules)
    );

    setSaved(true);
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>

        {/* HEADER */}

        <div style={styles.header}>
          <div>
            <div style={styles.logo}>
              JustBrand
            </div>

            <h1 style={styles.title}>
              MLM Commission Rules
            </h1>

            <p style={styles.subtitle}>
              Configure commission rules for the JustBrand MLM system.
            </p>
          </div>

          <div style={styles.status}>
            ● Commission System
          </div>
        </div>

        {/* SUCCESS */}

        {saved && (
          <div style={styles.success}>
            ✓ Commission rules saved successfully.
          </div>
        )}

        {/* DIRECT COMMISSION */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>👥</div>

            <div>
              <h2 style={styles.cardTitle}>
                Direct Member Commission
              </h2>

              <p style={styles.cardSubtitle}>
                Commission for members directly introduced by a member.
              </p>
            </div>
          </div>

          <div style={styles.formGrid}>

            <InputField
              label="Direct Commission (%)"
              value={rules.directCommission}
              onChange={(value) =>
                updateRule(
                  "directCommission",
                  Number(value)
                )
              }
            />

            <InputField
              label="Direct Member Limit"
              value={rules.directMemberLimit}
              onChange={(value) =>
                updateRule(
                  "directMemberLimit",
                  Number(value)
                )
              }
            />

          </div>

          <div style={styles.info}>
            ℹ️ A member can receive special direct
            commission for the first{" "}
            <strong>
              {rules.directMemberLimit}
            </strong>{" "}
            directly introduced members.
          </div>
        </section>

        {/* SHOPPING COMMISSION */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>🛒</div>

            <div>
              <h2 style={styles.cardTitle}>
                Shopping Commission
              </h2>

              <p style={styles.cardSubtitle}>
                Commission generated from eligible customer shopping.
              </p>
            </div>
          </div>

          <InputField
            label="Shopping Commission (%)"
            value={rules.shoppingCommission}
            onChange={(value) =>
              updateRule(
                "shoppingCommission",
                Number(value)
              )
            }
          />

          <div style={styles.info}>
            🛍️ When an eligible customer completes
            shopping on JustBrand, the applicable
            commission can be generated for the MLM network.
          </div>
        </section>

        {/* LEVEL COMMISSION */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>📊</div>

            <div>
              <h2 style={styles.cardTitle}>
                Level Commission
              </h2>

              <p style={styles.cardSubtitle}>
                Commission generated from the MLM network levels.
              </p>
            </div>
          </div>

          <InputField
            label="Level Commission (%)"
            value={rules.levelCommission}
            onChange={(value) =>
              updateRule(
                "levelCommission",
                Number(value)
              )
            }
          />

          <div style={styles.info}>
            🌐 This rule can be used for eligible
            purchases generated through the member network.
          </div>
        </section>

        {/* BINARY COMMISSION */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>🌳</div>

            <div>
              <h2 style={styles.cardTitle}>
                Binary Commission
              </h2>

              <p style={styles.cardSubtitle}>
                Commission based on the left and right binary teams.
              </p>
            </div>
          </div>

          <InputField
            label="Binary Commission (%)"
            value={rules.binaryCommission}
            onChange={(value) =>
              updateRule(
                "binaryCommission",
                Number(value)
              )
            }
          />

          <div style={styles.binaryBox}>
            <div>
              <span style={styles.sideLabel}>
                LEFT TEAM
              </span>

              <strong>
                Binary Network
              </strong>
            </div>

            <div style={styles.centerArrow}>
              ⇄
            </div>

            <div>
              <span style={styles.sideLabel}>
                RIGHT TEAM
              </span>

              <strong>
                Binary Network
              </strong>
            </div>
          </div>
        </section>

        {/* ORDER RULES */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>📦</div>

            <div>
              <h2 style={styles.cardTitle}>
                Order & Return Rules
              </h2>

              <p style={styles.cardSubtitle}>
                Commission is released only after the order becomes eligible.
              </p>
            </div>
          </div>

          <div style={styles.formGrid}>

            <InputField
              label="Return Period (Days)"
              value={rules.returnPeriodDays}
              onChange={(value) =>
                updateRule(
                  "returnPeriodDays",
                  Number(value)
                )
              }
            />

          </div>

          <Toggle
            label="Release Commission After Return Period"
            description="Commission remains pending until the return period is completed."
            checked={rules.commissionAfterReturn}
            onChange={(value) =>
              updateRule(
                "commissionAfterReturn",
                value
              )
            }
          />

          <Toggle
            label="Commission on Cancelled Order"
            description="If disabled, cancelled orders generate no commission."
            checked={rules.cancelCommission}
            onChange={(value) =>
              updateRule(
                "cancelCommission",
                value
              )
            }
          />

          <Toggle
            label="Commission on Returned Order"
            description="If disabled, returned orders do not generate payable commission."
            checked={rules.returnCommission}
            onChange={(value) =>
              updateRule(
                "returnCommission",
                value
              )
            }
          />

          <div style={styles.warning}>
            ⚠️ Current rule:
            <strong>
              {" "}
              Cancelled orders will not generate commission.
            </strong>
          </div>
        </section>

        {/* COMMISSION FLOW */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.icon}>🔄</div>

            <div>
              <h2 style={styles.cardTitle}>
                Commission Flow
              </h2>

              <p style={styles.cardSubtitle}>
                How an order moves through the commission system.
              </p>
            </div>
          </div>

          <div style={styles.flow}>

            <FlowStep
              number="1"
              icon="🛒"
              title="Order Placed"
              text="Customer purchases a product."
            />

            <div style={styles.flowArrow}>
              →
            </div>

            <FlowStep
              number="2"
              icon="⏳"
              title="Commission Pending"
              text="Commission remains locked."
            />

            <div style={styles.flowArrow}>
              →
            </div>

            <FlowStep
              number="3"
              icon="✓"
              title="Return Period"
              text={`${rules.returnPeriodDays} days eligibility period.`}
            />

            <div style={styles.flowArrow}>
              →
            </div>

            <FlowStep
              number="4"
              icon="💰"
              title="Wallet"
              text="Eligible commission becomes payable."
            />

          </div>
        </section>

        {/* ACTIONS */}

        <div style={styles.actions}>

          <button
            onClick={resetRules}
            style={styles.resetButton}
          >
            ↻ Reset Rules
          </button>

          <button
            onClick={saveRules}
            style={styles.saveButton}
          >
            ✓ Save Commission Rules
          </button>

        </div>

      </div>
    </div>
  );
}

/* ==========================================
   INPUT FIELD
========================================== */

function InputField({
  label,
  value,
  onChange,
}) {
  return (
    <div style={styles.field}>

      <label style={styles.label}>
        {label}
      </label>

      <div style={styles.inputWrapper}>

        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) =>
            onChange(e.target.value)
          }
          style={styles.input}
        />

        {label.includes("%") && (
          <span style={styles.inputSuffix}>
            %
          </span>
        )}

      </div>

    </div>
  );
}

/* ==========================================
   TOGGLE
========================================== */

function Toggle({
  label,
  description,
  checked,
  onChange,
}) {
  return (
    <div style={styles.toggleRow}>

      <div style={styles.toggleText}>

        <div style={styles.toggleLabel}>
          {label}
        </div>

        <div style={styles.toggleDescription}>
          {description}
        </div>

      </div>

      <button
        onClick={() =>
          onChange(!checked)
        }
        style={{
          ...styles.toggle,
          background: checked
            ? "#ff1493"
            : "#ccc",
        }}
      >
        <span
          style={{
            ...styles.toggleCircle,
            transform: checked
              ? "translateX(22px)"
              : "translateX(2px)",
          }}
        />
      </button>

    </div>
  );
}

/* ==========================================
   FLOW STEP
========================================== */

function FlowStep({
  number,
  icon,
  title,
  text,
}) {
  return (
    <div style={styles.flowStep}>

      <div style={styles.flowNumber}>
        {number}
      </div>

      <div style={styles.flowIcon}>
        {icon}
      </div>

      <div style={styles.flowTitle}>
        {title}
      </div>

      <div style={styles.flowText}>
        {text}
      </div>

    </div>
  );
}

/* ==========================================
   STYLES
========================================== */

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    padding: "25px",
    boxSizing: "border-box",
  },

  container: {
    maxWidth: "1100px",
    margin: "0 auto",
  },

  header: {
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "25px",
    borderRadius: "15px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px",
    flexWrap: "wrap",
    boxShadow:
      "0 4px 15px rgba(0,0,0,0.12)",
  },

  logo: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "8px",
  },

  title: {
    margin: 0,
    fontSize: "28px",
  },

  subtitle: {
    margin: "7px 0 0",
    opacity: 0.9,
    fontSize: "13px",
  },

  status: {
    background: "rgba(255,255,255,0.18)",
    padding: "10px 15px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
  },

  success: {
    marginTop: "15px",
    padding: "13px 15px",
    background: "#e9fff1",
    color: "#198754",
    borderRadius: "9px",
    border: "1px solid #c8f0d6",
    fontWeight: "bold",
    fontSize: "13px",
  },

  card: {
    background: "#fff",
    marginTop: "18px",
    padding: "22px",
    borderRadius: "14px",
    boxShadow:
      "0 2px 9px rgba(0,0,0,0.06)",
  },

  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "13px",
    marginBottom: "20px",
  },

  icon: {
    width: "48px",
    height: "48px",
    borderRadius: "11px",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    flexShrink: 0,
  },

  cardTitle: {
    margin: 0,
    fontSize: "19px",
  },

  cardSubtitle: {
    margin: "4px 0 0",
    color: "#888",
    fontSize: "12px",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: "18px",
  },

  field: {
    maxWidth: "350px",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontWeight: "bold",
    fontSize: "13px",
    color: "#444",
  },

  inputWrapper: {
    position: "relative",
  },

  input: {
    width: "100%",
    padding: "12px",
    paddingRight: "35px",
    boxSizing: "border-box",
    border: "1px solid #ddd",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
  },

  inputSuffix: {
    position: "absolute",
    right: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#777",
    fontWeight: "bold",
  },

  info: {
    marginTop: "15px",
    padding: "13px",
    background: "#eef7ff",
    borderRadius: "8px",
    color: "#555",
    fontSize: "12px",
    lineHeight: 1.5,
  },

  binaryBox: {
    marginTop: "20px",
    padding: "20px",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-around",
    textAlign: "center",
    gap: "15px",
  },

  sideLabel: {
    display: "block",
    color: "#ff1493",
    fontSize: "11px",
    fontWeight: "bold",
    marginBottom: "5px",
  },

  centerArrow: {
    fontSize: "25px",
    color: "#ff6b00",
    fontWeight: "bold",
  },

  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    padding: "15px 0",
    borderTop: "1px solid #eee",
  },

  toggleText: {
    flex: 1,
  },

  toggleLabel: {
    fontWeight: "bold",
    fontSize: "13px",
  },

  toggleDescription: {
    marginTop: "4px",
    color: "#888",
    fontSize: "11px",
    lineHeight: 1.4,
  },

  toggle: {
    width: "48px",
    height: "26px",
    border: "none",
    borderRadius: "20px",
    padding: 0,
    cursor: "pointer",
    position: "relative",
    flexShrink: 0,
    transition: "0.2s",
  },

  toggleCircle: {
    position: "absolute",
    top: "2px",
    left: "2px",
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    background: "#fff",
    transition: "0.2s",
    boxShadow:
      "0 1px 4px rgba(0,0,0,0.2)",
  },

  warning: {
    marginTop: "15px",
    padding: "13px",
    background: "#fff8e6",
    color: "#856404",
    borderRadius: "8px",
    fontSize: "12px",
  },

  flow: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
  },

  flowStep: {
    width: "170px",
    minHeight: "150px",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "11px",
    padding: "15px",
    boxSizing: "border-box",
    textAlign: "center",
    position: "relative",
  },

  flowNumber: {
    position: "absolute",
    top: "7px",
    right: "8px",
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    background: "#ff1493",
    color: "#fff",
    fontSize: "11px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
  },

  flowIcon: {
    fontSize: "28px",
    marginTop: "8px",
  },

  flowTitle: {
    marginTop: "9px",
    fontWeight: "bold",
    fontSize: "13px",
  },

  flowText: {
    marginTop: "5px",
    color: "#888",
    fontSize: "10px",
    lineHeight: 1.4,
  },

  flowArrow: {
    alignSelf: "center",
    fontSize: "25px",
    color: "#ff1493",
    fontWeight: "bold",
  },

  actions: {
    marginTop: "20px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  resetButton: {
    border: "1px solid #ddd",
    background: "#fff",
    color: "#555",
    padding: "12px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  saveButton: {
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "12px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },
};

export default MLMCommissionRules;
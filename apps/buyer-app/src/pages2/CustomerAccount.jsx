import React from "react";

function CustomerAccount({ customer, onBack, onOrders, onWishlist, onLogout }) {
  if (!customer) {
    return null;
  }

  return (
    <div style={styles.page}>
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
          <div style={styles.iconCircle}>👤</div>

          <h1 style={styles.title}>{customer.name}</h1>

          <p style={styles.subtitle}>
            📱 {customer.mobile}
            {customer.email ? ` · ${customer.email}` : ""}
          </p>

          {customer.referredByMemberId && (
            <div style={styles.refBox}>
              🎁 Referred by member: {customer.referredByMemberId}
            </div>
          )}

          <div style={styles.menuBox}>
            <button type="button" onClick={onOrders} style={styles.menuButton}>
              📦 My Orders
              <span style={styles.menuArrow}>›</span>
            </button>

            <button
              type="button"
              onClick={onWishlist}
              style={styles.menuButton}
            >
              ❤️ My Wishlist
              <span style={styles.menuArrow}>›</span>
            </button>
          </div>

          <button type="button" onClick={onLogout} style={styles.logoutButton}>
            🚪 Logout
          </button>

          <div style={styles.infoBox}>
            <div style={styles.infoText}>
              🔒 Your personal data is stored securely on our servers and is
              never shared with sellers beyond what is required to fulfil your
              order.
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
    background: "linear-gradient(135deg,#fff7f2,#fff0f7)",
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
    alignItems: "flex-start",
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
    textAlign: "center",
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
    fontSize: "24px",
  },

  subtitle: {
    margin: "6px 0 15px",
    color: "#777",
    fontSize: "14px",
  },

  refBox: {
    padding: "10px",
    background: "#fff7e6",
    borderRadius: "8px",
    fontSize: "13px",
    color: "#a06a00",
    marginBottom: "15px",
  },

  menuBox: {
    borderTop: "1px solid #eee",
    borderBottom: "1px solid #eee",
    margin: "15px 0",
  },

  menuButton: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "15px 5px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #f5f5f5",
    fontSize: "15px",
    color: "#333",
    cursor: "pointer",
  },

  menuArrow: {
    color: "#bbb",
    fontSize: "18px",
  },

  logoutButton: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ffb3b3",
    background: "#fff5f5",
    color: "#c00",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
    marginBottom: "15px",
  },

  infoBox: {
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

export default CustomerAccount;

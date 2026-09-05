import React, { useEffect, useState } from "react";

function SellerDashboard({
  seller,
  onLogout,
  onAddProduct,
  onMyProducts,
  onKYC,
  onOrders,
  onEarnings,
  onWallet,
  onProfile,
  onBank,
  onSettings,

  // ==========================================
  // MLM
  // ==========================================
  // MLM code रहेगा लेकिन mlmEnabled false होने पर
  // seller को MLM दिखाई नहीं देगा.
  mlmEnabled = false,
  onMLMDashboard,
  onMLMCommission,
  onMLMWallet,
}) {
  const [products, setProducts] = useState([]);
  const [activeMenu, setActiveMenu] = useState("dashboard");

  // ==========================================
  // LOAD SELLER PRODUCTS
  // ==========================================

  useEffect(() => {
    loadProducts();

    const timer = setInterval(() => {
      loadProducts();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  function loadProducts() {
    try {
      const saved = localStorage.getItem(
        "justbrand_seller_products"
      );

      if (saved) {
        const data = JSON.parse(saved);

        if (Array.isArray(data)) {
          setProducts(data);
        } else {
          setProducts([]);
        }
      } else {
        setProducts([]);
      }
    } catch (error) {
      console.log("Products loading error:", error);
      setProducts([]);
    }
  }

  // ==========================================
  // MENU CLICK
  // ==========================================

  function menuClick(menu) {
    setActiveMenu(menu);

    if (menu === "dashboard") {
      setActiveMenu("dashboard");
      return;
    }

    if (menu === "add-product") {
      if (onAddProduct) {
        onAddProduct();
      }
      return;
    }

    if (menu === "products") {
      if (onMyProducts) {
        onMyProducts();
      }
      return;
    }

    if (menu === "orders") {
      if (onOrders) {
        onOrders();
      } else {
        alert("Orders page connection pending.");
      }
      return;
    }

    if (menu === "earnings") {
      if (onEarnings) {
        onEarnings();
      } else {
        alert("Earnings page connection pending.");
      }
      return;
    }

    if (menu === "wallet") {
      if (onWallet) {
        onWallet();
      } else {
        alert("Seller Wallet connection pending.");
      }
      return;
    }

    if (menu === "profile") {
      if (onProfile) {
        onProfile();
      } else {
        alert("Seller Profile connection pending.");
      }
      return;
    }

    if (menu === "kyc") {
      if (onKYC) {
        onKYC();
      }
      return;
    }

    if (menu === "bank") {
      if (onBank) {
        onBank();
      } else {
        alert("Bank Account connection pending.");
      }
      return;
    }

    if (menu === "settings") {
      if (onSettings) {
        onSettings();
      } else {
        alert("Settings connection pending.");
      }
      return;
    }

    // ==========================================
    // MLM
    // ==========================================

    if (menu === "mlm-dashboard") {
      if (mlmEnabled && onMLMDashboard) {
        onMLMDashboard();
      }
      return;
    }

    if (menu === "mlm-commission") {
      if (mlmEnabled && onMLMCommission) {
        onMLMCommission();
      }
      return;
    }

    if (menu === "mlm-wallet") {
      if (mlmEnabled && onMLMWallet) {
        onMLMWallet();
      }
      return;
    }
  }

  // ==========================================
  // SELLER INFORMATION
  // ==========================================

  const sellerName =
    seller?.sellerName ||
    seller?.name ||
    "Seller";

  const shopName =
    seller?.shopName ||
    "Your Shop";

  const mobile =
    seller?.mobile ||
    seller?.phone ||
    "Not Added";

  const email =
    seller?.email ||
    "Not Added";

  // ==========================================
  // PRODUCT STATISTICS
  // ==========================================

  const totalProducts = products.length;

  const pendingProducts = products.filter(
    (product) =>
      String(product.status || "Pending").toLowerCase() ===
      "pending"
  ).length;

  const approvedProducts = products.filter(
    (product) =>
      String(product.status || "Pending").toLowerCase() ===
      "approved"
  ).length;

  const lowStockProducts = products.filter(
    (product) =>
      Number(product.stock || 0) <= 5
  ).length;

  // ==========================================
  // DASHBOARD
  // ==========================================

  return (
    <div style={styles.page}>

      {/* ======================================
          HEADER
      ====================================== */}

      <header style={styles.header}>

        <div style={styles.headerLeft}>

          <div style={styles.logo}>
            JustBrand
          </div>

          <div style={styles.panelText}>
            Seller Panel
          </div>

        </div>

        <div style={styles.headerRight}>

          <button
            onClick={() =>
              alert("No new notifications.")
            }
            style={styles.notificationButton}
          >
            🔔
          </button>

          <div style={styles.profileMini}>

            <div style={styles.avatar}>
              {sellerName.charAt(0).toUpperCase()}
            </div>

            <div>

              <div style={styles.profileMiniName}>
                {sellerName}
              </div>

              <div style={styles.profileMiniShop}>
                {shopName}
              </div>

            </div>

          </div>

        </div>

      </header>

      {/* ======================================
          LAYOUT
      ====================================== */}

      <div style={styles.layout}>

        {/* ====================================
            SIDEBAR
        ==================================== */}

        <aside style={styles.sidebar}>

          <div style={styles.sidebarTitle}>
            SELLER MENU
          </div>

          {/* Dashboard */}

          <MenuButton
            icon="🏠"
            text="Dashboard"
            active={activeMenu === "dashboard"}
            onClick={() =>
              menuClick("dashboard")
            }
          />

          {/* Add Product */}

          <MenuButton
            icon="➕"
            text="Add Product"
            active={activeMenu === "add-product"}
            onClick={() =>
              menuClick("add-product")
            }
          />

          {/* My Products */}

          <MenuButton
            icon="📦"
            text="My Products"
            active={activeMenu === "products"}
            onClick={() =>
              menuClick("products")
            }
          />

          {/* Orders */}

          <MenuButton
            icon="🛒"
            text="Orders"
            active={activeMenu === "orders"}
            onClick={() =>
              menuClick("orders")
            }
          />

          {/* Earnings */}

          <MenuButton
            icon="💰"
            text="Earnings"
            active={activeMenu === "earnings"}
            onClick={() =>
              menuClick("earnings")
            }
          />

          {/* Seller Wallet */}

          <MenuButton
            icon="💳"
            text="Seller Wallet"
            active={activeMenu === "wallet"}
            onClick={() =>
              menuClick("wallet")
            }
          />

          <div style={styles.menuDivider} />

          <div style={styles.sidebarTitle}>
            ACCOUNT
          </div>

          {/* Seller Profile */}

          <MenuButton
            icon="👤"
            text="Seller Profile"
            active={activeMenu === "profile"}
            onClick={() =>
              menuClick("profile")
            }
          />

          {/* KYC */}

          <MenuButton
            icon="🪪"
            text="KYC / Documents"
            active={activeMenu === "kyc"}
            onClick={() =>
              menuClick("kyc")
            }
          />

          {/* Bank */}

          <MenuButton
            icon="🏦"
            text="Bank Account"
            active={activeMenu === "bank"}
            onClick={() =>
              menuClick("bank")
            }
          />

          {/* Settings */}

          <MenuButton
            icon="⚙️"
            text="Settings"
            active={activeMenu === "settings"}
            onClick={() =>
              menuClick("settings")
            }
          />

          {/* ======================================
              MLM SECTION
              
              IMPORTANT:
              mlmEnabled false = MLM hidden
              
              Future:
              mlmEnabled true = MLM visible
          ====================================== */}

          {mlmEnabled && (
            <>
              <div style={styles.menuDivider} />

              <div style={styles.sidebarTitle}>
                JUSTBRAND MLM
              </div>

              <MenuButton
                icon="👥"
                text="MLM Dashboard"
                active={
                  activeMenu === "mlm-dashboard"
                }
                onClick={() =>
                  menuClick("mlm-dashboard")
                }
              />

              <MenuButton
                icon="💰"
                text="MLM Commission"
                active={
                  activeMenu === "mlm-commission"
                }
                onClick={() =>
                  menuClick("mlm-commission")
                }
              />

              <MenuButton
                icon="💳"
                text="MLM Wallet"
                active={
                  activeMenu === "mlm-wallet"
                }
                onClick={() =>
                  menuClick("mlm-wallet")
                }
              />
            </>
          )}

          {/* Logout */}

          <div style={styles.logoutArea}>

            <button
              onClick={onLogout}
              style={styles.logoutButton}
            >
              🚪 Logout
            </button>

          </div>

        </aside>

        {/* ====================================
            CONTENT
        ==================================== */}

        <main style={styles.content}>

          {/* ==================================
              WELCOME
          ================================== */}

          <div style={styles.welcomeBox}>

            <div>

              <h1 style={styles.welcomeTitle}>
                Welcome, {sellerName} 👋
              </h1>

              <p style={styles.welcomeText}>
                Manage your JustBrand seller
                account from here.
              </p>

            </div>

            <button
              onClick={onAddProduct}
              style={styles.primaryButton}
            >
              ➕ Add New Product
            </button>

          </div>

          {/* ==================================
              STATISTICS
          ================================== */}

          <div style={styles.statsGrid}>

            <StatCard
              icon="📦"
              title="Total Products"
              value={totalProducts}
              description="Products added"
            />

            <StatCard
              icon="🕐"
              title="Pending"
              value={pendingProducts}
              description="Waiting for approval"
            />

            <StatCard
              icon="✅"
              title="Approved"
              value={approvedProducts}
              description="Live products"
            />

            <StatCard
              icon="⚠️"
              title="Low Stock"
              value={lowStockProducts}
              description="Need attention"
            />

          </div>

          {/* ==================================
              QUICK ACTIONS
          ================================== */}

          <section style={styles.section}>

            <div style={styles.sectionHeader}>

              <div>

                <h2 style={styles.sectionTitle}>
                  ⚡ Quick Actions
                </h2>

                <p style={styles.sectionSubtitle}>
                  Quickly manage your seller
                  account.
                </p>

              </div>

            </div>

            <div style={styles.quickGrid}>

              <QuickAction
                icon="➕"
                title="Add Product"
                description="List a new product"
                onClick={onAddProduct}
              />

              <QuickAction
                icon="📦"
                title="My Products"
                description="Manage your products"
                onClick={onMyProducts}
              />

              <QuickAction
                icon="🛒"
                title="Orders"
                description="Manage customer orders"
                onClick={() =>
                  menuClick("orders")
                }
              />

              <QuickAction
                icon="💰"
                title="Earnings"
                description="View your earnings"
                onClick={() =>
                  menuClick("earnings")
                }
              />

              <QuickAction
                icon="💳"
                title="Seller Wallet"
                description="Manage wallet balance"
                onClick={() =>
                  menuClick("wallet")
                }
              />

              <QuickAction
                icon="🪪"
                title="KYC / Documents"
                description="Complete seller verification"
                onClick={onKYC}
              />

              <QuickAction
                icon="🏦"
                title="Bank Account"
                description="Manage payment account"
                onClick={() =>
                  menuClick("bank")
                }
              />

              <QuickAction
                icon="⚙️"
                title="Settings"
                description="Manage account settings"
                onClick={() =>
                  menuClick("settings")
                }
              />

            </div>

          </section>

          {/* ==================================
              SELLER ACCOUNT
          ================================== */}

          <section style={styles.section}>

            <div style={styles.sectionHeader}>

              <div>

                <h2 style={styles.sectionTitle}>
                  👤 Seller Account
                </h2>

                <p style={styles.sectionSubtitle}>
                  Your basic seller information.
                </p>

              </div>

              <button
                onClick={() =>
                  menuClick("profile")
                }
                style={styles.editButton}
              >
                ✏️ Edit Details
              </button>

            </div>

            <div style={styles.accountGrid}>

              <InfoBox
                icon="👤"
                label="Seller Name"
                value={sellerName}
              />

              <InfoBox
                icon="🏪"
                label="Shop Name"
                value={shopName}
              />

              <InfoBox
                icon="📱"
                label="Mobile"
                value={mobile}
              />

              <InfoBox
                icon="📧"
                label="Email"
                value={email}
              />

            </div>

          </section>

          {/* ==================================
              KYC
          ================================== */}

          <section style={styles.kycBox}>

            <div style={styles.kycIcon}>
              🪪
            </div>

            <div style={styles.kycContent}>

              <h3 style={{ margin: "0 0 5px" }}>
                Complete Seller KYC
              </h3>

              <p
                style={{
                  margin: 0,
                  color: "#666",
                  fontSize: "14px",
                }}
              >
                Submit PAN Card, Aadhaar Card,
                GST Certificate and Bank Account
                details to activate your seller
                account.
              </p>

            </div>

            <button
              onClick={onKYC}
              style={styles.kycButton}
            >
              Complete KYC →
            </button>

          </section>

          {/* ==================================
              RECENT PRODUCTS
          ================================== */}

          <section style={styles.section}>

            <div style={styles.sectionHeader}>

              <div>

                <h2 style={styles.sectionTitle}>
                  📦 Recent Products
                </h2>

                <p style={styles.sectionSubtitle}>
                  Your latest added products.
                </p>

              </div>

              {products.length > 0 && (
                <button
                  onClick={onMyProducts}
                  style={styles.viewAllButton}
                >
                  View All →
                </button>
              )}

            </div>

            {products.length === 0 ? (

              <div style={styles.emptyProducts}>

                <div style={{ fontSize: "45px" }}>
                  📦
                </div>

                <h3>
                  No Products Yet
                </h3>

                <p>
                  Start selling by adding your
                  first product.
                </p>

                <button
                  onClick={onAddProduct}
                  style={styles.primaryButton}
                >
                  ➕ Add First Product
                </button>

              </div>

            ) : (

              <div style={styles.recentGrid}>

                {products
                  .slice(-4)
                  .reverse()
                  .map((product) => (
                    <RecentProduct
                      key={product.id}
                      product={product}
                    />
                  ))}

              </div>

            )}

          </section>

        </main>

      </div>

    </div>
  );
}

/* ==========================================
   MENU BUTTON
========================================== */

function MenuButton({
  icon,
  text,
  active,
  onClick,
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        border: "none",
        background: active
          ? "#fff0f5"
          : "transparent",
        color: active
          ? "#ff1493"
          : "#444",
        padding: "12px 15px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        textAlign: "left",
        borderRadius: "8px",
        cursor: "pointer",
        fontWeight: active
          ? "bold"
          : "500",
        fontSize: "14px",
        marginBottom: "4px",
      }}
    >
      <span style={{ fontSize: "18px" }}>
        {icon}
      </span>

      {text}
    </button>
  );
}

/* ==========================================
   STAT CARD
========================================== */

function StatCard({
  icon,
  title,
  value,
  description,
}) {
  return (
    <div style={styles.statCard}>

      <div style={styles.statIcon}>
        {icon}
      </div>

      <div style={styles.statTitle}>
        {title}
      </div>

      <div style={styles.statValue}>
        {value}
      </div>

      <div style={styles.statDescription}>
        {description}
      </div>

    </div>
  );
}

/* ==========================================
   QUICK ACTION
========================================== */

function QuickAction({
  icon,
  title,
  description,
  onClick,
}) {
  return (
    <button
      onClick={onClick}
      style={styles.quickAction}
    >

      <div style={styles.quickIcon}>
        {icon}
      </div>

      <div style={styles.quickTitle}>
        {title}
      </div>

      <div style={styles.quickDescription}>
        {description}
      </div>

      <div style={styles.quickArrow}>
        →
      </div>

    </button>
  );
}

/* ==========================================
   INFO BOX
========================================== */

function InfoBox({
  icon,
  label,
  value,
}) {
  return (
    <div style={styles.infoBox}>

      <div style={styles.infoIcon}>
        {icon}
      </div>

      <div>

        <div style={styles.infoLabel}>
          {label}
        </div>

        <div style={styles.infoValue}>
          {value}
        </div>

      </div>

    </div>
  );
}

/* ==========================================
   RECENT PRODUCT
========================================== */

function RecentProduct({ product }) {
  return (
    <div style={styles.recentProduct}>

      <div style={styles.recentImageBox}>

        <img
          src={
            product.image ||
            "/images/product1.png"
          }
          alt={
            product.name ||
            "Product"
          }
          onError={(e) => {
            e.currentTarget.src =
              "/images/product1.png";
          }}
          style={styles.recentImage}
        />

      </div>

      <div style={styles.recentContent}>

        <div style={styles.recentCategory}>
          {product.category || "Product"}
        </div>

        <div style={styles.recentName}>
          {product.name || "Product"}
        </div>

        <div style={styles.recentPrice}>
          {product.price || "₹0"}
        </div>

        <div style={styles.recentStatus}>
          🕐 {product.status || "Pending"}
        </div>

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
    color: "#222",
  },

  header: {
    minHeight: "70px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 25px",
    boxSizing: "border-box",
    gap: "15px",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  panelText: {
    borderLeft:
      "1px solid rgba(255,255,255,0.5)",
    paddingLeft: "12px",
    fontSize: "14px",
  },

  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },

  notificationButton: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "none",
    background:
      "rgba(255,255,255,0.18)",
    color: "#fff",
    fontSize: "18px",
    cursor: "pointer",
  },

  profileMini: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  avatar: {
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    background: "#fff",
    color: "#ff1493",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "18px",
  },

  profileMiniName: {
    fontSize: "13px",
    fontWeight: "bold",
  },

  profileMiniShop: {
    fontSize: "11px",
    opacity: 0.85,
  },

  layout: {
    display: "flex",
    minHeight:
      "calc(100vh - 70px)",
    alignItems: "stretch",
  },

  sidebar: {
    width: "245px",
    background: "#fff",
    padding: "20px 12px",
    boxSizing: "border-box",
    borderRight:
      "1px solid #eee",
    flexShrink: 0,
  },

  sidebarTitle: {
    fontSize: "10px",
    fontWeight: "bold",
    color: "#999",
    padding: "5px 12px 10px",
    letterSpacing: "0.5px",
  },

  menuDivider: {
    height: "1px",
    background: "#eee",
    margin: "15px 5px",
  },

  logoutArea: {
    marginTop: "25px",
    padding: "10px 5px",
    borderTop:
      "1px solid #eee",
  },

  logoutButton: {
    width: "100%",
    padding: "11px",
    border: "none",
    borderRadius: "8px",
    background: "#fff0f0",
    color: "#dc3545",
    cursor: "pointer",
    fontWeight: "bold",
  },

  content: {
    flex: 1,
    minWidth: 0,
    padding: "25px",
    boxSizing: "border-box",
  },

  welcomeBox: {
    background:
      "linear-gradient(135deg,#fff,#fff8f5)",
    borderRadius: "14px",
    padding: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    boxShadow:
      "0 2px 10px rgba(0,0,0,0.06)",
    border:
      "1px solid #f1f1f1",
  },

  welcomeTitle: {
    margin: 0,
    fontSize: "25px",
  },

  welcomeText: {
    margin: "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  primaryButton: {
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(180px,1fr))",
    gap: "15px",
    marginTop: "20px",
  },

  statCard: {
    background: "#fff",
    borderRadius: "12px",
    padding: "18px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
  },

  statIcon: {
    fontSize: "27px",
  },

  statTitle: {
    marginTop: "7px",
    color: "#666",
    fontSize: "13px",
  },

  statValue: {
    marginTop: "3px",
    fontSize: "27px",
    fontWeight: "bold",
  },

  statDescription: {
    marginTop: "3px",
    color: "#999",
    fontSize: "11px",
  },

  section: {
    marginTop: "22px",
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    marginBottom: "15px",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "19px",
  },

  sectionSubtitle: {
    margin: "5px 0 0",
    color: "#888",
    fontSize: "13px",
  },

  quickGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(200px,1fr))",
    gap: "12px",
  },

  quickAction: {
    position: "relative",
    textAlign: "left",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "17px",
    cursor: "pointer",
  },

  quickIcon: {
    fontSize: "27px",
  },

  quickTitle: {
    marginTop: "8px",
    fontWeight: "bold",
    fontSize: "15px",
  },

  quickDescription: {
    marginTop: "4px",
    color: "#888",
    fontSize: "12px",
  },

  quickArrow: {
    position: "absolute",
    right: "15px",
    top: "50%",
    transform:
      "translateY(-50%)",
    fontSize: "20px",
    color: "#ff1493",
  },

  accountGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: "12px",
  },

  infoBox: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px",
    background: "#fafafa",
    borderRadius: "10px",
    border:
      "1px solid #eee",
  },

  infoIcon: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "19px",
  },

  infoLabel: {
    fontSize: "11px",
    color: "#999",
  },

  infoValue: {
    marginTop: "3px",
    fontSize: "14px",
    fontWeight: "bold",
    wordBreak: "break-word",
  },

  editButton: {
    border: "none",
    background: "#fff0f5",
    color: "#ff1493",
    padding: "8px 12px",
    borderRadius: "7px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  kycBox: {
    marginTop: "22px",
    background:
      "linear-gradient(135deg,#fff8e8,#fff)",
    border:
      "1px solid #ffe0a3",
    borderRadius: "14px",
    padding: "18px",
    display: "flex",
    alignItems: "center",
    gap: "15px",
    flexWrap: "wrap",
  },

  kycIcon: {
    width: "50px",
    height: "50px",
    borderRadius: "12px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "25px",
  },

  kycContent: {
    flex: 1,
    minWidth: "200px",
  },

  kycButton: {
    border: "none",
    background: "#ff6b00",
    color: "#fff",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  viewAllButton: {
    border: "none",
    background: "#fff0f5",
    color: "#ff1493",
    padding: "8px 13px",
    borderRadius: "7px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  emptyProducts: {
    textAlign: "center",
    padding: "35px 15px",
    color: "#777",
  },

  recentGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(230px,1fr))",
    gap: "15px",
  },

  recentProduct: {
    display: "flex",
    gap: "12px",
    background: "#fafafa",
    border:
      "1px solid #eee",
    borderRadius: "10px",
    padding: "10px",
  },

  recentImageBox: {
    width: "85px",
    height: "85px",
    borderRadius: "8px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },

  recentImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },

  recentContent: {
    minWidth: 0,
    flex: 1,
  },

  recentCategory: {
    fontSize: "10px",
    color: "#999",
  },

  recentName: {
    marginTop: "4px",
    fontWeight: "bold",
    fontSize: "14px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  recentPrice: {
    marginTop: "5px",
    color: "#ff6b00",
    fontWeight: "bold",
  },

  recentStatus: {
    marginTop: "5px",
    fontSize: "11px",
    color: "#856404",
  },
};

export default SellerDashboard;
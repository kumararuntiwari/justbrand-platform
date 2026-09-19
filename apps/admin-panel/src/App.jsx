import { useEffect, useState } from "react";
import "./App.css";
import Business from "./Business";
import OverviewSection from "./OverviewSection";
import BuyersSection from "./BuyersSection";
import ContentManager from "./ContentManager";
import {
  LevelCommissionsEditor,
  FamilyGiftsManager,
} from "./FamilyManagers";
import BuyerSettingsPanel from "./BuyerSettingsPanel";

const API = "https://justbrand-in-144629.hostingersite.com";

function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("justbrand_staff_token") || ""
  );

  const [staff, setStaff] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("justbrand_staff_user") || "null"
      );
    } catch {
      return null;
    }
  });

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");

  const [products, setProducts] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [activeView, setActiveView] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [businessTabKey, setBusinessTabKey] = useState("sellers");
  const [showNotifications, setShowNotifications] = useState(false);

  const [loading, setLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [showStaffForm, setShowStaffForm] = useState(false);

  const [newStaff, setNewStaff] = useState({
    name: "",
    username: "",
    password: "",
    role: "staff",
  });

  // ==========================================
  // SAVE LOGIN
  // ==========================================

  const saveLogin = (newToken, newStaff) => {
    localStorage.setItem("justbrand_staff_token", newToken);
    localStorage.setItem(
      "justbrand_staff_user",
      JSON.stringify(newStaff)
    );

    setToken(newToken);
    setStaff(newStaff);
  };

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Sign out of the JustBrand Admin console?")
    ) {
      return;
    }

    localStorage.removeItem("justbrand_staff_token");
    localStorage.removeItem("justbrand_staff_user");

    setToken("");
    setStaff(null);
    setProducts([]);
    setStaffList([]);
    setCustomers([]);
    setMembers([]);
    setOrders([]);
    setSellers([]);
    setActiveView("overview");
    setMessage("");
  };

  // ==========================================
  // LOGIN
  // ==========================================

  const login = async (e) => {
    e.preventDefault();

    setLoginLoading(true);
    setLoginMessage("");

    try {
      const response = await fetch(`${API}/api/staff/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setLoginMessage(data.message || "Login failed.");
        return;
      }

      saveLogin(data.token, data.staff);

      setLoginUsername("");
      setLoginPassword("");
    } catch (error) {
      console.error(error);
      setLoginMessage(
        "❌ Backend से connection नहीं हो रहा।"
      );
    } finally {
      setLoginLoading(false);
    }
  };

  // ==========================================
  // CUSTOMERS + FAMILY MEMBERS (Buyers/Overview sections)
  // ==========================================

  const loadCustomers = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/admin/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();

      if (data.success) {
        setCustomers(data.customers || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const loadMembers = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/admin/mlm/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();

      if (data.success) {
        setMembers(data.members || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const loadOrders = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/admin/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();

      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const loadSellers = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/admin/sellers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      const data = await response.json();

      if (data.success) {
        setSellers(data.sellers || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // ==========================================
  // CURRENT STAFF
  // ==========================================

  const loadCurrentStaff = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/staff/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        logout();
        return;
      }

      setStaff(data.staff);

      localStorage.setItem(
        "justbrand_staff_user",
        JSON.stringify(data.staff)
      );
    } catch (error) {
      console.error(error);
    }
  };

  // ==========================================
  // PRODUCTS
  // ==========================================

  const loadProducts = async () => {
    if (!token) return;

    try {
      setLoading(true);

      const response = await fetch(
        `${API}/api/admin/products`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (data.success) {
        setProducts(data.products || []);
      } else {
        setMessage(data.message || "Products load नहीं हुए।");
      }
    } catch (error) {
      console.error(error);
      setMessage("❌ Backend से connection नहीं हो रहा।");
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // STAFF LIST
  // ==========================================

  const loadStaff = async () => {
    if (!token || staff?.role !== "super_admin") return;

    try {
      setStaffLoading(true);

      const response = await fetch(
        `${API}/api/admin/staff`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok || !data.success) {
        setMessage(
          data.message || "Staff list load नहीं हुई।"
        );
        return;
      }

      setStaffList(data.staff || []);
    } catch (error) {
      console.error(error);
      setMessage("❌ Staff list load नहीं हो सकी।");
    } finally {
      setStaffLoading(false);
    }
  };

  // ==========================================
  // CREATE STAFF
  // ==========================================

  const createStaff = async (e) => {
    e.preventDefault();

    if (
      !newStaff.name.trim() ||
      !newStaff.username.trim() ||
      !newStaff.password.trim()
    ) {
      setMessage("कृपया सभी Staff details भरें।");
      return;
    }

    try {
      const response = await fetch(
        `${API}/api/admin/staff`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(newStaff),
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok || !data.success) {
        setMessage(
          data.message || "Staff account create नहीं हुआ।"
        );
        return;
      }

      setMessage("✅ Staff account successfully created.");

      setNewStaff({
        name: "",
        username: "",
        password: "",
        role: "staff",
      });

      setShowStaffForm(false);

      loadStaff();
    } catch (error) {
      console.error(error);
      setMessage("❌ Staff account create नहीं हो सका।");
    }
  };

  // ==========================================
  // DELETE STAFF
  // ==========================================

  const deleteStaff = async (id) => {
    if (!window.confirm("क्या आप यह Staff account delete करना चाहते हैं?")) {
      return;
    }

    try {
      const response = await fetch(
        `${API}/api/admin/staff/${id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok || !data.success) {
        setMessage(
          data.message || "Staff account delete नहीं हुआ।"
        );
        return;
      }

      setMessage("✅ Staff account deleted successfully.");

      loadStaff();
    } catch (error) {
      console.error(error);
      setMessage("❌ Staff account delete नहीं हो सका।");
    }
  };

  // ==========================================
  // APPROVE PRODUCT
  // ==========================================

  const approveProduct = async (id) => {
    try {
      const response = await fetch(
        `${API}/api/admin/products/${id}/approve`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (data.success) {
        setMessage("✅ Product approved successfully.");
        loadProducts();
      } else {
        setMessage(data.message || "Approval failed.");
      }
    } catch (error) {
      console.error(error);
      setMessage("❌ Product approve नहीं हो सका।");
    }
  };

  // ==========================================
  // REJECT PRODUCT
  // ==========================================

  const rejectProduct = async (id) => {
    try {
      const response = await fetch(
        `${API}/api/admin/products/${id}/reject`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        logout();
        return;
      }

      if (data.success) {
        setMessage("❌ Product rejected.");
        loadProducts();
      } else {
        setMessage(data.message || "Reject failed.");
      }
    } catch (error) {
      console.error(error);
      setMessage("❌ Product reject नहीं हो सका।");
    }
  };

  // ==========================================
  // EFFECTS
  // ==========================================

  useEffect(() => {
    if (token) {
      loadCurrentStaff();
    }
  }, [token]);

  useEffect(() => {
    if (token && staff) {
      loadProducts();

      if (staff.role === "super_admin") {
        loadStaff();
      }

      if (staff.role === "super_admin" || staff.role === "manager") {
        loadCustomers();
        loadMembers();
      }

      if (
        ["super_admin", "manager", "accountant"].includes(
          staff.role
        )
      ) {
        loadOrders();
      }

      if (staff.role === "super_admin" || staff.role === "manager") {
        loadSellers();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, staff]);

  // ==========================================
  // LOGIN SCREEN
  // ==========================================

  if (!token || !staff) {
    return (
      <div className="admin-app">
        <div
          style={{
            minHeight: "100svh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background:
              "radial-gradient(1200px 600px at 15% -10%, rgba(255,122,0,0.14), transparent 60%), radial-gradient(1000px 520px at 110% 110%, rgba(255,20,147,0.12), transparent 55%), #f4f5f8",
          }}
        >
          <form
            onSubmit={login}
            className="login-card"
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "#fff",
              padding: "35px",
              borderRadius: "18px",
              boxShadow:
                "0 15px 45px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "58px",
                  height: "58px",
                  margin: "0 auto 14px",
                  borderRadius: "16px",
                  background: "linear-gradient(135deg, #ff7a00, #ff3d81)",
                  color: "#fff",
                  fontSize: "26px",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 24px rgba(255,61,129,0.28)",
                }}
              >
                J
              </div>
              <h1>JustBrand</h1>
              <h2>Admin Login</h2>
              <p style={{ color: "#777", fontSize: "13.5px", marginTop: "6px" }}>
                Staff & Super Admin Management
              </p>
            </div>

            {loginMessage && (
              <div
                style={{
                  marginTop: "20px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#fff0f0",
                  color: "#c62828",
                }}
              >
                {loginMessage}
              </div>
            )}

            <div style={{ marginTop: "20px" }}>
              <label>Username</label>

              <input
                type="text"
                value={loginUsername}
                onChange={(e) =>
                  setLoginUsername(e.target.value)
                }
                placeholder="Enter username"
                autoComplete="username"
                style={{
                  width: "100%",
                  padding: "13px",
                  marginTop: "7px",
                  border: "1px solid #ddd",
                  borderRadius: "9px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginTop: "18px" }}>
              <label>Password</label>

              <input
                type="password"
                value={loginPassword}
                onChange={(e) =>
                  setLoginPassword(e.target.value)
                }
                placeholder="Enter password"
                autoComplete="current-password"
                style={{
                  width: "100%",
                  padding: "13px",
                  marginTop: "7px",
                  border: "1px solid #ddd",
                  borderRadius: "9px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                width: "100%",
                marginTop: "25px",
                padding: "14px",
                border: "none",
                borderRadius: "10px",
                background:
                  "linear-gradient(90deg, #ff7a00, #ff3d81)",
                color: "#fff",
                fontSize: "16px",
                fontWeight: "700",
              }}
            >
              {loginLoading ? "Logging in..." : "🔐 Login"}
            </button>

            <p
              style={{
                marginTop: "20px",
                textAlign: "center",
                fontSize: "13px",
                color: "#777",
              }}
            >
              Authorized JustBrand staff only
            </p>
          </form>
        </div>
      </div>
    );
  }

  const pendingProducts = products.filter(
    (product) => product.status === "Pending"
  );

  const approvedProducts = products.filter(
    (product) => product.status === "Approved"
  );

  const rejectedProducts = products.filter(
    (product) => product.status === "Rejected"
  );

  // Counts for the header notifications bell — real pending work only,
  // taken from the feeds this role already loaded (no extra API calls).
  const pendingProductsCount = pendingProducts.length;
  const pendingOrdersCount = orders.filter((o) => o.status === "Pending").length;

  // Sidebar navigation model. Sections the staff member's role cannot
  // open are still listed but disabled — permissions stay visible.
  const canManageStaff = staff?.role === "super_admin";
  const canUseCustomers = staff?.role === "super_admin" || staff?.role === "manager";
  const canUseOrders = ["super_admin", "manager", "accountant"].includes(staff?.role);
  const canUseSellers = staff?.role === "super_admin" || staff?.role === "manager";

  // Grouped sidebar — grouped nav model with the same role gating as
  // before (items outside a role simply stay disabled/hidden).
  const navGroups = [
    {
      label: "Business",
      items: [
        { key: "overview", label: "📊 Overview", enabled: true, crumb: "Overview" },
        { key: "cm-about", label: "📖 About Us", enabled: canUseSellers, crumb: "Business · About Us" },
        { key: "cm-contact", label: "📞 Contact Us", enabled: canUseSellers, crumb: "Business · Contact Us" },
        { key: "cm-branding", label: "🎨 Logo & Branding", enabled: canUseSellers, crumb: "Business · Logo & Branding" },
      ],
    },
    {
      label: "Buyer Experience",
      items: [
        { key: "cm-banners", label: "🖼️ Homepage Banners", enabled: canUseSellers, crumb: "Buyer Experience · Banners" },
        { key: "cm-homepage", label: "🏠 Homepage Content", enabled: canUseSellers, crumb: "Buyer Experience · Homepage" },
        { key: "buyer-settings", label: "⚙️ Buyer Settings", enabled: canUseSellers, crumb: "Buyer Experience · Settings" },
      ],
    },
    {
      label: "Commerce",
      items: [
        { key: "products", label: "🏷️ Products", enabled: canUseSellers, crumb: "Products" },
        { key: "orders", label: "📦 Orders", enabled: canUseOrders, crumb: "Orders" },
        { key: "sellers", label: "🏪 Sellers", enabled: canUseSellers, crumb: "Sellers" },
        { key: "buyers", label: "🛒 Buyers", enabled: canUseCustomers, crumb: "Buyers" },
        { key: "kyc", label: "🪪 KYC", enabled: canUseSellers, crumb: "KYC" },
      ],
    },
    {
      label: "JustBrand Family",
      items: [
        { key: "family", label: "👨‍👩‍👧 Family Overview", enabled: canUseSellers, crumb: "Family · Overview" },
        { key: "fam-commission", label: "💰 Commission Settings", enabled: canUseSellers, crumb: "Family · Commission Settings" },
        { key: "fam-levels", label: "📈 Level-wise Commission", enabled: canUseSellers, crumb: "Family · Level Commission" },
        { key: "fam-gifts", label: "🎁 Level-wise Gifts", enabled: canUseSellers, crumb: "Family · Gifts" },
        { key: "fam-rules", label: "📐 Family Rules", enabled: canUseSellers, crumb: "Family · Rules" },
        { key: "tree", label: "🌳 Family Tree", enabled: canUseSellers, crumb: "Family Tree" },
      ],
    },
    {
      label: "Administration",
      items: [
        { key: "staff", label: "👥 Staff", enabled: canManageStaff, crumb: "Staff" },
      ],
    },
  ];

  const navItems = navGroups.flatMap((g) => g.items);

  const activeNavItem = navItems.find((item) => item.key === activeView) || navItems[0];

  function openView(key) {
    const item = navItems.find((n) => n.key === key);
    if (!item || !item.enabled) return;

    // Business tabs share one component — map admin views to its tabs.
    // Family sub-views reuse the Family (mlm) tab.
    if (["sellers", "orders", "family", "kyc", "tree", "fam-commission", "fam-levels", "fam-gifts", "fam-rules"].includes(key)) {
      setBusinessTabKey(key === "family" || key.startsWith("fam-") ? "mlm" : key);
    }

    setActiveView(key);
    setSidebarOpen(false);
  }

  return (
    <div className="admin-app">

      {/* HEADER */}

      <header className="admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div>
            <h1>JustBrand Admin</h1>
            <p>Marketplace & Family Operations Console</p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          {/* Role-aware identity chip */}
          <div className="user-chip">
            <span className="user-avatar">
              {(staff.name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="user-meta">
              <strong>{staff.name}</strong>
              <small>{staff.role}</small>
            </span>
          </div>

          {/* Notifications — real pending work from already-loaded feeds.
              Counts adapt to the role; staff roles see fewer items. */}
          {(() => {
            const kycPendingCount = sellers.filter(
              (s) => (s.kycStatus || "Pending") === "Pending"
            ).length;
            const ordersPendingCount = orders.filter(
              (o) => o.status === "Pending"
            ).length;
            const notifTotal =
              pendingProductsCount + kycPendingCount + ordersPendingCount;

            const notifItems = [];
            if (pendingProductsCount > 0)
              notifItems.push({
                icon: "🏷️",
                label: `${pendingProductsCount} product(s) awaiting approval`,
                target: "products",
              });
            if (kycPendingCount > 0)
              notifItems.push({
                icon: "🪪",
                label: `${kycPendingCount} seller KYC(s) pending`,
                target: "kyc",
              });
            if (ordersPendingCount > 0)
              notifItems.push({
                icon: "📦",
                label: `${ordersPendingCount} order(s) pending`,
                target: "orders",
              });

            return (
              <div className="notif-wrap">
                <button
                  type="button"
                  className="notif-btn"
                  onClick={() => setShowNotifications(!showNotifications)}
                  aria-label="Notifications"
                >
                  🔔
                  {notifTotal > 0 && (
                    <span className="notif-badge">
                      {notifTotal > 99 ? "99+" : notifTotal}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <>
                    <div
                      className="notif-backdrop"
                      onClick={() => setShowNotifications(false)}
                    />
                    <div className="notif-pop">
                      <header>Notifications — pending work</header>
                      {notifItems.length === 0 ? (
                        <div className="notif-empty">
                          🎉 Nothing pending — all caught up!
                        </div>
                      ) : (
                        <ul>
                          {notifItems.map((n) => (
                            <li
                              key={n.target}
                              onClick={() => {
                                openView(n.target);
                                setShowNotifications(false);
                              }}
                            >
                              <span className="notif-emoji">{n.icon}</span>
                              <span className="notif-main">
                                <strong>{n.label}</strong>
                                <small>Tap to open the section</small>
                              </span>
                              <span aria-hidden="true">›</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <button
            className="refresh-btn"
            onClick={() => {
              loadProducts();

              if (staff.role === "super_admin") {
                loadStaff();
              }

              if (staff.role === "super_admin" || staff.role === "manager") {
                loadCustomers();
                loadMembers();
                loadSellers();
              }

              if (
                ["super_admin", "manager", "accountant"].includes(
                  staff.role
                )
              ) {
                loadOrders();
              }
            }}
          >
            🔄 Refresh
          </button>

          <button
            className="refresh-btn"
            onClick={logout}
          >
            🚪 Logout
          </button>
        </div>
      </header>

      {/* SIDEBAR NAVIGATION */}

      <nav className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              activeView === item.key
                ? "sidebar-item active"
                : "sidebar-item"
            }
            disabled={!item.enabled}
            title={item.enabled ? item.label : "Not available for your role"}
            onClick={() => openView(item.key)}
          >
            <span>{item.label}</span>
            {!item.enabled && <small className="sidebar-lock">🔒</small>}
          </button>
        ))}

        <div className="sidebar-foot">
          <small>{staff.role}</small>
          <small>{customers.length} buyers · {members.length} members</small>
        </div>
      </nav>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="admin-content">

        {/* BREADCRUMB */}

        <div className="breadcrumb">
          <span>JustBrand Admin</span>
          <span className="breadcrumb-sep">›</span>
          <span className="breadcrumb-current">{activeNavItem.crumb}</span>
        </div>

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {/* OVERVIEW (KPIs + charts) */}

        {activeView === "overview" && (
          <OverviewSection
            token={{ token, role: staff.role }}
            onNavigate={(key) => openView(key)}
          />
        )}

        {/* BUYERS */}

        {activeView === "buyers" && canUseCustomers && (
          <BuyersSection
            customers={customers}
            orders={orders}
            members={members}
          />
        )}

        {/* BUSINESS (Sellers / Orders / Family / KYC / Tree) */}

        {/* CONTENT MANAGER (About/Contact/Branding/Banners/Homepage) */}

        {["cm-about", "cm-contact", "cm-branding", "cm-banners", "cm-homepage"].includes(
          activeView
        ) && (
          <ContentManager
            token={token}
            section={activeView.replace("cm-", "")}
            isSuper={staff.role === "super_admin"}
            onMessage={(msg) => {
              setMessage(msg);

              setTimeout(() => setMessage(""), 4000);
            }}
          />
        )}

        {/* LEVEL-WISE COMMISSION MANAGER */}

        {activeView === "fam-levels" && canUseSellers && (
          <LevelCommissionsEditor
            token={token}
            isSuper={staff.role === "super_admin"}
            onMessage={(msg) => {
              setMessage(msg);

              setTimeout(() => setMessage(""), 4000);
            }}
          />
        )}

        {/* LEVEL-WISE GIFTS MANAGER */}

        {activeView === "fam-gifts" && canUseSellers && (
          <FamilyGiftsManager
            token={token}
            onMessage={(msg) => {
              setMessage(msg);

              setTimeout(() => setMessage(""), 4000);
            }}
          />
        )}

        {/* BUYER SETTINGS (fallback behaviour overview — read-only) */}

        {activeView === "buyer-settings" && (
          <BuyerSettingsPanel
            customers={customers}
            products={products}
          />
        )}

        {/* FAMILY COMMISSION/GIFTS/RULES sub-views — Family (mlm) tab
            is the single source of truth; Commission Settings and Rules
            render inside it. Levels/Gifts render dedicated managers. */}

        {activeView !== "overview" &&
          activeView !== "buyers" &&
          activeView !== "products" &&
          activeView !== "staff" &&
          activeView !== "buyer-settings" &&
          ![
            "cm-about",
            "cm-contact",
            "cm-branding",
            "cm-banners",
            "cm-homepage",
            "fam-levels",
            "fam-gifts",
          ].includes(activeView) && (
            <Business
              token={token}
              staff={staff}
              customers={customers}
              members={members}
              products={products}
              initialTab={businessTabKey}
              onMessage={(msg) => {
                setMessage(msg);

                setTimeout(() => setMessage(""), 4000);
              }}
            />
          )}

        {/* STAFF + STATS (Super Admin console view) */}

        {activeView === "staff" && (
        <>

        <div className="stats">

          <div className="stat-card pending-card">
            <span>Pending Products</span>
            <strong>{pendingProducts.length}</strong>
          </div>

          <div className="stat-card approved-card">
            <span>Approved Products</span>
            <strong>{approvedProducts.length}</strong>
          </div>

          <div className="stat-card rejected-card">
            <span>Rejected Products</span>
            <strong>{rejectedProducts.length}</strong>
          </div>

          <div className="stat-card">
            <span>Total Products</span>
            <strong>{products.length}</strong>
          </div>

        </div>

        {/* SUPER ADMIN (visible only on Staff view) */}

        {activeView === "staff" && staff.role === "super_admin" && (
          <section className="products-section">

            <div className="section-title">
              <div>
                <h2>🔐 Super Admin</h2>
                <p>Full administrative access enabled.</p>
              </div>

              <span>SUPER ADMIN</span>
            </div>

            {/* STAFF MANAGEMENT */}

            <div
              style={{
                padding: "20px",
                border: "1px solid #eee",
                borderRadius: "14px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>
                    👥 Staff Management
                  </h3>

                  <small>
                    Manager, Accountant और Staff accounts manage करें।
                  </small>
                </div>

                <button
                  className="approve"
                  onClick={() =>
                    setShowStaffForm(!showStaffForm)
                  }
                >
                  {showStaffForm
                    ? "✕ Close"
                    : "＋ Add Staff"}
                </button>
              </div>

              {/* CREATE STAFF FORM */}

              {showStaffForm && (
                <form
                  onSubmit={createStaff}
                  style={{
                    marginTop: "20px",
                    padding: "20px",
                    background: "#fff8f2",
                    borderRadius: "12px",
                  }}
                >
                  <h3>Create Staff Account</h3>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    <input
                      placeholder="Full Name"
                      value={newStaff.name}
                      onChange={(e) =>
                        setNewStaff({
                          ...newStaff,
                          name: e.target.value,
                        })
                      }
                      style={inputStyle}
                    />

                    <input
                      placeholder="Username"
                      value={newStaff.username}
                      onChange={(e) =>
                        setNewStaff({
                          ...newStaff,
                          username: e.target.value,
                        })
                      }
                      style={inputStyle}
                    />

                    <input
                      type="password"
                      placeholder="Password"
                      value={newStaff.password}
                      onChange={(e) =>
                        setNewStaff({
                          ...newStaff,
                          password: e.target.value,
                        })
                      }
                      style={inputStyle}
                    />

                    <select
                      value={newStaff.role}
                      onChange={(e) =>
                        setNewStaff({
                          ...newStaff,
                          role: e.target.value,
                        })
                      }
                      style={inputStyle}
                    >
                      <option value="staff">
                        Staff
                      </option>

                      <option value="manager">
                        Manager
                      </option>

                      <option value="accountant">
                        Accountant
                      </option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="approve"
                    style={{
                      marginTop: "15px",
                    }}
                  >
                    ✓ Create Account
                  </button>
                </form>
              )}

              {/* STAFF LIST */}

              <div style={{ marginTop: "20px" }}>
                {staffLoading ? (
                  <div className="empty">
                    Staff loading...
                  </div>
                ) : staffList.length === 0 ? (
                  <div className="empty">
                    कोई Staff account नहीं है।
                  </div>
                ) : (
                  <div className="simple-list">

                    {staffList.map((item) => (
                      <div
                        className="list-item"
                        key={item.id}
                      >
                        <div>
                          <strong>
                            {item.name}
                          </strong>

                          <small>
                            Username: {item.username}
                            {" | "}
                            Role: {item.role}
                            {" | "}
                            Status: {item.status}
                          </small>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <span
                            className={
                              item.status === "active"
                                ? "approved"
                                : "rejected"
                            }
                          >
                            {item.status}
                          </span>

                          {item.id !== staff.id && (
                            <button
                              className="reject"
                              onClick={() =>
                                deleteStaff(item.id)
                              }
                            >
                              🗑 Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                  </div>
                )}
              </div>
            </div>

            {/* FINANCIAL CONTROL */}

            <div className="simple-list">

              <div className="list-item">
                <div>
                  <strong>
                    Financial Controls
                  </strong>

                  <small>
                    Payment और financial actions
                    Super Admin तक restricted रहेंगे।
                  </small>
                </div>

                <span className="approved">
                  ✓ Restricted
                </span>
              </div>

            </div>

          </section>
        )}
        </>
        )}

        {/* PRODUCTS (product management view) */}

        {activeView === "products" && (
        <>

        <section className="products-section">

          <div className="section-title">
            <div>
              <h2>Pending Products</h2>

              <p>
                Seller द्वारा भेजे गए products approval के लिए
              </p>
            </div>

            <span>
              {pendingProducts.length} Pending
            </span>
          </div>

          {loading ? (
            <div className="empty">
              Products loading...
            </div>
          ) : pendingProducts.length === 0 ? (
            <div className="empty">
              कोई Pending Product नहीं है।
            </div>
          ) : (
            <div className="product-grid">

              {pendingProducts.map((product) => (
                <div
                  className="product-card"
                  key={product.id}
                >

                  <div className="product-image">

                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        onError={(e) => {
                          e.currentTarget.style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <span>No Image</span>
                    )}

                  </div>

                  <div className="product-info">

                    <div className="product-top">

                      <h3>{product.name}</h3>

                      <span className="pending">
                        {product.status}
                      </span>

                    </div>

                    <p>
                      <b>Seller:</b>{" "}
                      {product.sellerName || "Unknown"}
                    </p>

                    <p>
                      <b>Category:</b>{" "}
                      {product.category || "-"}
                    </p>

                    <p className="price">
                      ₹{product.price || "0"}
                    </p>

                    {product.comparePrice && (
                      <p>
                        <b>Compare Price:</b>{" "}
                        ₹{product.comparePrice}
                      </p>
                    )}

                    {product.shortDetails && (
                      <p>
                        <b>Details:</b>{" "}
                        {product.shortDetails}
                      </p>
                    )}

                    {product.description && (
                      <p className="description">
                        {product.description}
                      </p>
                    )}

                    <div className="actions">

                      <button
                        className="approve"
                        onClick={() =>
                          approveProduct(product.id)
                        }
                      >
                        ✓ Approve
                      </button>

                      <button
                        className="reject"
                        onClick={() =>
                          rejectProduct(product.id)
                        }
                      >
                        ✕ Reject
                      </button>

                    </div>

                  </div>

                </div>
              ))}

            </div>
          )}

        </section>

        {/* APPROVED */}

        <section className="products-section">

          <div className="section-title">
            <div>
              <h2>Approved Products</h2>

              <p>
                ये products Buyer App में दिखाई देंगे
              </p>
            </div>

            <span>
              {approvedProducts.length} Approved
            </span>
          </div>

          {approvedProducts.length === 0 ? (
            <div className="empty">
              अभी कोई Approved Product नहीं है।
            </div>
          ) : (
            <div className="simple-list">

              {approvedProducts.map((product) => (
                <div
                  className="list-item"
                  key={product.id}
                >
                  <div>
                    <strong>{product.name}</strong>

                    <small>
                      Seller:{" "}
                      {product.sellerName || "-"}
                      {" | "}
                      ₹{product.price || "0"}
                    </small>
                  </div>

                  <span className="approved">
                    ✓ Approved
                  </span>
                </div>
              ))}

            </div>
          )}

        </section>
        </>
        )}

        {/* REJECTED */}

        {activeView === "products" && (
        <>

        <section className="products-section">

          <div className="section-title">
            <div>
              <h2>Rejected Products</h2>

              <p>
                Admin द्वारा reject किए गए products
              </p>
            </div>

            <span>
              {rejectedProducts.length} Rejected
            </span>
          </div>

          {rejectedProducts.length === 0 ? (
            <div className="empty">
              अभी कोई Rejected Product नहीं है।
            </div>
          ) : (
            <div className="simple-list">

              {rejectedProducts.map((product) => (
                <div
                  className="list-item"
                  key={product.id}
                >
                  <div>
                    <strong>{product.name}</strong>

                    <small>
                      Seller:{" "}
                      {product.sellerName || "-"}
                      {" | "}
                      ₹{product.price || "0"}
                    </small>
                  </div>

                  <span className="rejected">
                    ✕ Rejected
                  </span>
                </div>
              ))}

            </div>
          )}

        </section>
        </>
        )}

        {/* STAFF console close */}

      </main>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  boxSizing: "border-box",
};


export default App;
import React, { useEffect, useState } from "react";
import "../index.css";

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
  mlmEnabled = false,
  onMLMDashboard,
  onMLMCommission,
  onMLMWallet,
}) {
  const [products, setProducts] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("dashboard");

  useEffect(() => {
    loadProducts();
    const timer = setInterval(loadProducts, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  function loadProducts() {
    try {
      const saved = localStorage.getItem("justbrand_seller_products");
      const data = saved ? JSON.parse(saved) : [];
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      setProducts([]);
    }
  }

  function navigate(menu) {
    setActiveMenu(menu);
    setMenuOpen(false);
    const actions = {
      "add-product": onAddProduct,
      products: onMyProducts,
      orders: onOrders,
      earnings: onEarnings,
      wallet: onWallet,
      profile: onProfile,
      kyc: onKYC,
      bank: onBank,
      settings: onSettings,
      "mlm-dashboard": mlmEnabled ? onMLMDashboard : null,
      "mlm-commission": mlmEnabled ? onMLMCommission : null,
      "mlm-wallet": mlmEnabled ? onMLMWallet : null,
    };
    if (actions[menu]) actions[menu]();
  }

  const sellerName = seller?.sellerName || seller?.name || "Seller";
  const shopName = seller?.shopName || "Your Shop";
  const mobile = seller?.mobile || seller?.phone || "Not Added";
  const email = seller?.email || "Not Added";

  const totalProducts = products.length;
  const pendingProducts = products.filter(p => String(p.status || "Pending").toLowerCase() === "pending").length;
  const approvedProducts = products.filter(p => String(p.status || "").toLowerCase() === "approved").length;
  const lowStockProducts = products.filter(p => Number(p.stock || 0) <= 5).length;

  const navGroups = [
    {
      label: "Workspace",
      items: [
        ["dashboard", "⌂", "Dashboard"],
        ["add-product", "＋", "Add Product"],
        ["products", "▣", "My Products"],
        ["orders", "▤", "Orders"],
        ["earnings", "₹", "Earnings"],
        ["wallet", "◈", "Seller Wallet"],
      ],
    },
    {
      label: "Account",
      items: [
        ["profile", "◉", "Seller Profile"],
        ["kyc", "✓", "KYC / Documents"],
        ["bank", "▥", "Bank Account"],
        ["settings", "⚙", "Settings"],
      ],
    },
  ];

  if (mlmEnabled) {
    navGroups.push({
      label: "JustBrand Family",
      items: [
        ["mlm-dashboard", "◎", "Family Dashboard"],
        ["mlm-commission", "₹", "Family Commission"],
        ["mlm-wallet", "◈", "Family Wallet"],
      ],
    });
  }

  return (
    <div className="seller-pro-page">
      <header className="seller-pro-header jb-header">
        <div className="seller-pro-brand">
          <button className="jb-menu-btn seller-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
          <div className="seller-brand-mark">JB</div>
          <div>
            <div className="seller-brand-name">JustBrand</div>
            <div className="seller-brand-sub">SELLER CENTER</div>
          </div>
        </div>
        <div className="seller-header-right">
          <div className="seller-header-status"><span className="status-dot" /> Seller account</div>
          <button className="seller-icon-btn jb-notification-btn" onClick={() => alert("No new notifications.")}>🔔</button>
          <div className="seller-profile-chip">
            <div className="seller-avatar">{sellerName.charAt(0).toUpperCase()}</div>
            <div className="seller-profile-copy">
              <strong>{sellerName}</strong>
              <span>{shopName}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="seller-pro-layout">
        <aside className={`seller-pro-sidebar jb-sidebar${menuOpen ? " open" : ""}`}>
          <div className="seller-sidebar-head">
            <span>SELLER CENTER</span>
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
          </div>
          {navGroups.map(group => (
            <div className="seller-nav-group" key={group.label}>
              <div className="seller-nav-label">{group.label}</div>
              {group.items.map(([key, icon, label]) => (
                <button key={key} className={`seller-nav-item ${activeMenu === key ? "active" : ""}`} onClick={() => navigate(key)}>
                  <span className="seller-nav-icon">{icon}</span><span>{label}</span>
                  {key === "orders" && <span className="seller-nav-arrow">›</span>}
                </button>
              ))}
            </div>
          ))}
          <button className="seller-logout" onClick={onLogout}>↪ <span>Logout</span></button>
        </aside>

        <div className={`jb-drawer-overlay${menuOpen ? " show" : ""}`} onClick={() => setMenuOpen(false)} />

        <main className="seller-pro-main jb-content">
          <section className="seller-hero">
            <div className="seller-hero-glow" />
            <div className="seller-hero-copy">
              <div className="seller-eyebrow">SELLER DASHBOARD</div>
              <h1>Welcome back, {sellerName} <span>👋</span></h1>
              <p>Grow your store, manage products and keep your business moving.</p>
              <div className="seller-hero-actions">
                <button className="seller-primary-cta" onClick={onAddProduct}>＋ Add New Product</button>
                <button className="seller-secondary-cta" onClick={onMyProducts}>View Products →</button>
              </div>
            </div>
            <div className="seller-hero-orbit"><div>JB</div><span>SELL</span><span>GROW</span></div>
          </section>

          <section className="seller-kpi-grid">
            <KpiCard icon="▣" label="Total Products" value={totalProducts} note="Your catalogue" />
            <KpiCard icon="◷" label="Pending Approval" value={pendingProducts} note="Needs review" tone="orange" />
            <KpiCard icon="✓" label="Approved Products" value={approvedProducts} note="Ready for buyers" tone="green" />
            <KpiCard icon="!" label="Low Stock" value={lowStockProducts} note="Needs attention" tone="pink" />
          </section>

          <section className="seller-content-grid">
            <div className="seller-panel seller-quick-panel">
              <PanelHeading eyebrow="OPERATIONS" title="Quick actions" subtitle="Everything you need, one click away." />
              <div className="seller-action-grid">
                <ActionCard icon="＋" title="Add Product" text="List a new product" onClick={onAddProduct} primary />
                <ActionCard icon="▣" title="My Products" text="Manage your catalogue" onClick={onMyProducts} />
                <ActionCard icon="▤" title="Orders" text="Track customer orders" onClick={() => navigate("orders")} />
                <ActionCard icon="₹" title="Earnings" text="View business earnings" onClick={() => navigate("earnings")} />
                <ActionCard icon="◈" title="Seller Wallet" text="Balance & transactions" onClick={() => navigate("wallet")} />
                <ActionCard icon="✓" title="KYC / Documents" text="Verification center" onClick={onKYC} />
              </div>
            </div>

            <div className="seller-panel seller-status-panel">
              <PanelHeading eyebrow="ACCOUNT HEALTH" title="Store readiness" subtitle="Keep these areas complete." />
              <StatusRow label="Seller profile" value="Manage" onClick={() => navigate("profile")} complete />
              <StatusRow label="KYC verification" value="Open" onClick={onKYC} />
              <StatusRow label="Bank account" value="Manage" onClick={() => navigate("bank")} />
              <StatusRow label="Product catalogue" value={totalProducts ? `${totalProducts} listed` : "Start listing"} onClick={onMyProducts} complete={totalProducts > 0} />
              <div className="seller-health-footer"><span>JustBrand Seller Center</span><strong>Build • Sell • Grow</strong></div>
            </div>
          </section>

          <section className="seller-panel seller-account-panel">
            <PanelHeading eyebrow="BUSINESS PROFILE" title="Your seller account" subtitle="Core account information." action={<button className="seller-text-btn" onClick={() => navigate("profile")}>Edit details →</button>} />
            <div className="seller-account-grid">
              <InfoTile icon="◉" label="Seller Name" value={sellerName} />
              <InfoTile icon="⌂" label="Shop Name" value={shopName} />
              <InfoTile icon="☎" label="Mobile" value={mobile} />
              <InfoTile icon="✉" label="Email" value={email} />
            </div>
          </section>

          <section className="seller-panel seller-products-panel">
            <PanelHeading eyebrow="CATALOGUE" title="Recent products" subtitle="Latest products added to your store." action={products.length ? <button className="seller-text-btn" onClick={onMyProducts}>View all →</button> : null} />
            {products.length ? (
              <div className="seller-recent-grid">
                {products.slice(-4).reverse().map(product => <RecentProduct key={product.id} product={product} />)}
              </div>
            ) : (
              <div className="seller-empty">
                <div className="seller-empty-icon">▣</div>
                <h3>Your catalogue is waiting</h3>
                <p>Add your first product and start building your JustBrand store.</p>
                <button className="seller-primary-cta" onClick={onAddProduct}>＋ Add First Product</button>
              </div>
            )}
          </section>

          <section className="seller-kyc-banner">
            <div className="seller-kyc-badge">✓</div>
            <div><div className="seller-eyebrow">VERIFICATION CENTER</div><h3>Complete your seller KYC</h3><p>PAN, Aadhaar, GST and bank details help activate your seller account.</p></div>
            <button onClick={onKYC}>Open KYC →</button>
          </section>
        </main>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, note, tone = "" }) {
  return <div className={`seller-kpi-card ${tone}`}><div className="seller-kpi-top"><span className="seller-kpi-icon">{icon}</span><span className="seller-kpi-live">LIVE</span></div><div className="seller-kpi-value">{value}</div><div className="seller-kpi-label">{label}</div><div className="seller-kpi-note">{note}</div></div>;
}

function PanelHeading({ eyebrow, title, subtitle, action }) {
  return <div className="seller-panel-heading"><div><div className="seller-eyebrow">{eyebrow}</div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}

function ActionCard({ icon, title, text, onClick, primary }) {
  return <button className={`seller-action-card ${primary ? "primary" : ""}`} onClick={onClick}><span className="seller-action-icon">{icon}</span><span><strong>{title}</strong><small>{text}</small></span><b>→</b></button>;
}

function StatusRow({ label, value, onClick, complete }) {
  return <button className="seller-status-row" onClick={onClick}><span className={`seller-check ${complete ? "complete" : ""}`}>{complete ? "✓" : "•"}</span><span>{label}</span><strong>{value} ›</strong></button>;
}

function InfoTile({ icon, label, value }) {
  return <div className="seller-info-tile"><span className="seller-info-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function RecentProduct({ product }) {
  return <div className="seller-recent-card"><div className="seller-recent-image"><img src={product.image || "/images/product1.png"} alt={product.name || "Product"} onError={e => { e.currentTarget.src = "/images/product1.png"; }} /></div><div className="seller-recent-copy"><small>{product.category || "Product"}</small><strong>{product.name || "Product"}</strong><b>{product.customerPrice || product.price || "₹0"}</b><span>{String(product.status || "Pending")}</span></div></div>;
}

export default SellerDashboard;

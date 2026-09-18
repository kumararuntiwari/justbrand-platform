import React, { useState } from "react";

// ==========================================
// SELLER PAGES
// ==========================================

import SellerRegister from "./pages/SellerRegister";
import SellerLogin from "./pages/SellerLogin";
import SellerDashboard from "./pages/SellerDashboard";
import AddProduct from "./pages/AddProduct";
import MyProducts from "./pages/MyProducts";
import SellerKYC from "./pages/SellerKYC";
import Orders from "./pages/Orders";

// ==========================================
// MLM PAGES
// ==========================================



function App() {

  // ==========================================
  // MLM VISIBILITY CONTROL
  // ==========================================
  //
  // false = Seller ko MLM nahi dikhega
  //
  // future me true karne par Seller Dashboard
  // me MLM section dikhaya ja sakta hai.
  //
  // ==========================================

  const [mlmEnabled] = useState(false);

  // ==========================================
  // INITIAL PAGE
  // ==========================================

  const [page, setPage] = useState(() => {

    const sellerLoggedIn =
      localStorage.getItem(
        "justbrand_seller_logged_in"
      );

    const mlmLoggedIn =
      localStorage.getItem(
        "justbrand_mlm_logged_in"
      );

    // ------------------------------------------
    // Agar MLM already logged in hai
    // ------------------------------------------

    if (mlmLoggedIn === "true") {
      return "mlm-dashboard";
    }

    // ------------------------------------------
    // Agar Seller already logged in hai
    // ------------------------------------------

    if (sellerLoggedIn === "true") {
      return "dashboard";
    }

    // ------------------------------------------
    // Default Seller Login
    // ------------------------------------------

    return "login";
  });

  // ==========================================
  // SELLER DATA
  // ==========================================

  const [seller, setSeller] = useState(() => {

    try {

      const saved =
        localStorage.getItem(
          "justbrand_seller"
        );

      return saved
        ? JSON.parse(saved)
        : null;

    } catch (error) {

      console.log(
        "Seller loading error:",
        error
      );

      return null;
    }
  });

  // ==========================================
  // MLM MEMBER DATA
  // ==========================================

  const [member, setMember] = useState(() => {

    try {

      const saved =
        localStorage.getItem(
          "justbrand_mlm_member"
        );

      return saved
        ? JSON.parse(saved)
        : null;

    } catch (error) {

      console.log(
        "MLM member loading error:",
        error
      );

      return null;
    }
  });

  // ==========================================
  // SELLER LOGIN
  // ==========================================

  function handleLogin(sellerData) {

    setSeller(sellerData);

    localStorage.setItem(
      "justbrand_seller_logged_in",
      "true"
    );

    localStorage.setItem(
      "justbrand_seller",
      JSON.stringify(sellerData)
    );

    setPage("dashboard");
  }

  // ==========================================
  // SELLER REGISTER
  // ==========================================

  function handleRegister(sellerData) {

    setSeller(sellerData);

    localStorage.setItem(
      "justbrand_seller",
      JSON.stringify(sellerData)
    );

    // Registration ke baad Login page
    setPage("login");
  }

  // ==========================================
  // SELLER LOGOUT
  // ==========================================

  function handleLogout() {

    localStorage.removeItem(
      "justbrand_seller_logged_in"
    );

    setSeller(null);

    setPage("login");
  }

  // ==========================================
  // SELLER DASHBOARD
  // ==========================================

  function handleDashboard() {

    setPage("dashboard");
  }

  // ==========================================
  // ADD PRODUCT
  // ==========================================

  function handleAddProduct() {

    setPage("add-product");
  }

  // ==========================================
  // MY PRODUCTS
  // ==========================================

  function handleMyProducts() {

    setPage("my-products");
  }

  // ==========================================
  // ORDERS
  // ==========================================

  function handleOrders() {

    setPage("orders");
  }

  // ==========================================
  // EARNINGS
  // ==========================================

  function handleEarnings() {

    setPage("earnings");
  }

  // ==========================================
  // SELLER WALLET
  // ==========================================

  function handleWallet() {

    setPage("wallet");
  }

  // ==========================================
  // SELLER PROFILE
  // ==========================================

  function handleProfile() {

    setPage("profile");
  }

  // ==========================================
  // SELLER KYC
  // ==========================================

  function handleKYC() {

    setPage("kyc");
  }

  // ==========================================
  // BANK ACCOUNT
  // ==========================================

  function handleBank() {

    setPage("bank");
  }

  // ==========================================
  // SETTINGS
  // ==========================================

  function handleSettings() {

    setPage("settings");
  }

  // ==========================================
  // PRODUCT ADDED
  // ==========================================

  function handleProductAdded(product) {

    console.log(
      "New product added:",
      product
    );

    setPage("my-products");
  }

  // ==========================================
  // MLM LOGIN
  // ==========================================

  function handleMLMLogin(memberData) {

    setMember(memberData);

    localStorage.setItem(
      "justbrand_mlm_member",
      JSON.stringify(memberData)
    );

    localStorage.setItem(
      "justbrand_mlm_logged_in",
      "true"
    );

    setPage("mlm-dashboard");
  }

  // ==========================================
  // MLM REGISTER
  // ==========================================

  function handleMLMRegister(memberData) {

    setMember(memberData);

    localStorage.setItem(
      "justbrand_mlm_member",
      JSON.stringify(memberData)
    );

    setPage("mlm-login");
  }

  // ==========================================
  // MLM LOGOUT
  // ==========================================

  function handleMLMLogout() {

    localStorage.removeItem(
      "justbrand_mlm_logged_in"
    );

    setMember(null);

    setPage("mlm-login");
  }

  // ==========================================
  // MLM DASHBOARD
  // ==========================================

  function handleMLMDashboard() {

    if (!mlmEnabled) {
      return;
    }

    setPage("mlm-dashboard");
  }

  // ==========================================
  // MLM COMMISSION
  // ==========================================

  function handleMLMCommission() {

    if (!mlmEnabled) {
      return;
    }

    setPage("mlm-commission");
  }

  // ==========================================
  // MLM WALLET
  // ==========================================

  function handleMLMWallet() {

    if (!mlmEnabled) {
      return;
    }

    setPage("mlm-wallet");
  }

  // ==========================================
  // SELLER REGISTER PAGE
  // ==========================================

  if (page === "register") {

    return (
      <SellerRegister
        onRegister={handleRegister}
        onLogin={() =>
          setPage("login")
        }
      />
    );
  }

  // ==========================================
  // SELLER LOGIN PAGE
  // ==========================================

  if (page === "login") {

    return (
      <SellerLogin
        onLogin={handleLogin}
        onRegister={() =>
          setPage("register")
        }
      />
    );
  }

  // ==========================================
  // MLM REGISTER PAGE
  // ==========================================

  if (page === "mlm-register") {

    return (
      <MLMRegister
        onRegister={handleMLMRegister}
        onLogin={() =>
          setPage("mlm-login")
        }
      />
    );
  }

  // ==========================================
  // MLM LOGIN PAGE
  // ==========================================

  if (page === "mlm-login") {

    return (
      <MLMLogin
        onLogin={handleMLMLogin}
        onRegister={() =>
          setPage("mlm-register")
        }
      />
    );
  }

  // ==========================================
  // MLM DASHBOARD
  // ==========================================

  if (page === "mlm-dashboard") {

    return (
      <MLMDashboard
        member={member}
        onLogout={handleMLMLogout}
        onCommission={handleMLMCommission}
        onWallet={handleMLMWallet}
      />
    );
  }

  // ==========================================
  // MLM COMMISSION
  // ==========================================

  if (page === "mlm-commission") {

    return (
      <MLMCommission
        member={member}
        onBack={handleMLMDashboard}
      />
    );
  }

  // ==========================================
  // MLM WALLET
  // ==========================================

  if (page === "mlm-wallet") {

    return (
      <MLMWallet
        member={member}
        onBack={handleMLMDashboard}
      />
    );
  }

  // ==========================================
  // ADD PRODUCT
  // ==========================================

  if (page === "add-product") {

    return (
      <AddProduct
        onBack={handleDashboard}
        onProductAdded={handleProductAdded}
      />
    );
  }

  // ==========================================
  // MY PRODUCTS
  // ==========================================

  if (page === "my-products") {

    return (
      <MyProducts
        onBack={handleDashboard}
        onAddProduct={handleAddProduct}
      />
    );
  }

  // ==========================================
  // ORDERS
  // ==========================================

  if (page === "orders") {

    return (
      <Orders
        seller={seller}
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SELLER KYC
  // ==========================================

  if (page === "kyc") {

    return (
      <SellerKYC
        seller={seller}
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SELLER EARNINGS
  // ==========================================

  if (page === "earnings") {

    return (
      <SimplePage
        title="💰 Seller Earnings"
        description="Your earnings and commission details will appear here."
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SELLER WALLET
  // ==========================================

  if (page === "wallet") {

    return (
      <SimplePage
        title="💳 Seller Wallet"
        description="Your wallet balance, credits and transactions will appear here."
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SELLER PROFILE
  // ==========================================

  if (page === "profile") {

    return (
      <SimplePage
        title="👤 Seller Profile"
        description="Seller profile details will appear here."
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // BANK ACCOUNT
  // ==========================================

  if (page === "bank") {

    return (
      <SimplePage
        title="🏦 Bank Account"
        description="Bank account and payout details will appear here."
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SETTINGS
  // ==========================================

  if (page === "settings") {

    return (
      <SimplePage
        title="⚙️ Settings"
        description="Seller account settings will appear here."
        onBack={handleDashboard}
      />
    );
  }

  // ==========================================
  // SELLER DASHBOARD
  // ==========================================

  if (page === "dashboard") {

    return (
      <SellerDashboard
        seller={seller}

        onLogout={handleLogout}

        onAddProduct={handleAddProduct}

        onMyProducts={handleMyProducts}

        onKYC={handleKYC}

        onOrders={handleOrders}

        onEarnings={handleEarnings}

        onWallet={handleWallet}

        onProfile={handleProfile}

        onBank={handleBank}

        onSettings={handleSettings}

        onReturnPolicy={() => setPage("return-policy")}

        // ======================================
        // MLM
        // ======================================
        // अभी FALSE है इसलिए Seller Dashboard
        // में MLM दिखाई नहीं देगा.
        //
        // बाद में true करने पर MLM दिखेगा.
        // ======================================

        mlmEnabled={mlmEnabled}

        onMLMDashboard={
          handleMLMDashboard
        }

        onMLMCommission={
          handleMLMCommission
        }

        onMLMWallet={
          handleMLMWallet
        }
      />
    );
  }

  // ==========================================
  // FALLBACK
  // ==========================================

  return null;
}

// ==========================================
// SIMPLE PAGE
// ==========================================

function SimplePage({
  title,
  description,
  onBack,
}) {

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
      }}
    >

      {/* ======================================
          HEADER
      ====================================== */}

      <header
        style={{
          background:
            "linear-gradient(135deg,#ff6b00,#ff1493)",
          color: "#fff",
          padding: "15px 25px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "15px",
          flexWrap: "wrap",
          boxSizing: "border-box",
        }}
      >

        <div>

          <div
            style={{
              fontSize: "24px",
              fontWeight: "bold",
            }}
          >
            JustBrand
          </div>

          <div
            style={{
              fontSize: "12px",
              opacity: 0.9,
            }}
          >
            Seller Panel
          </div>

        </div>

        <button
          onClick={onBack}
          style={{
            background: "#fff",
            color: "#ff1493",
            border: "none",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← Dashboard
        </button>

      </header>

      {/* ======================================
          CONTENT
      ====================================== */}

      <main
        style={{
          maxWidth: "1000px",
          margin: "0 auto",
          padding: "25px",
          boxSizing: "border-box",
        }}
      >

        <div
          style={{
            background: "#fff",
            borderRadius: "14px",
            padding: "40px 25px",
            textAlign: "center",
            boxShadow:
              "0 2px 10px rgba(0,0,0,0.06)",
          }}
        >

          <div
            style={{
              fontSize: "55px",
            }}
          >
            {title.split(" ")[0]}
          </div>

          <h1
            style={{
              marginTop: "15px",
            }}
          >
            {title}
          </h1>

          <p
            style={{
              color: "#777",
              fontSize: "15px",
            }}
          >
            {description}
          </p>

          <button
            onClick={onBack}
            style={{
              marginTop: "20px",
              background:
                "linear-gradient(135deg,#ff6b00,#ff1493)",
              color: "#fff",
              border: "none",
              padding: "12px 22px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ← Back to Dashboard
          </button>

        </div>

      </main>

    </div>
  );
}

export default App;
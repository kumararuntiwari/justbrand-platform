
import React, { useState } from "react";

function Header({
  cartCount,
  onCart,
  search,
  setSearch,
  filteredProducts,
  filteredCategories,
  onProductSelect,
  onAccount,
  onWishlist,
  onOrders,
  onFamily,
  onInfoPage,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // ==================================================
  // CLOSE MENU
  // ==================================================

  const closeMenu = () => {
    setMenuOpen(false);
  };

  // ==================================================
  // OPEN SELLER APP
  // ==================================================

  const handleSeller = () => {
  closeMenu();

  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const sellerUrl = isLocal
    ? `${window.location.protocol}//${window.location.hostname}:5175/`
    : "https://seller.justbrand.in/";

  window.location.href = sellerUrl;
};

  // ==================================================
  // PRODUCT SELECT
  // ==================================================

  const handleProductSelect = (product) => {
    if (onProductSelect) {
      onProductSelect(product);
    }

    closeMenu();
  };

  // ==================================================
  // CATEGORY SELECT
  // ==================================================

  const handleCategory = (category) => {
    setSearch(category);
    closeMenu();
  };

  // ==================================================
  // LOGIN
  // ==================================================

  const handleLogin = () => {
    closeMenu();

    if (onAccount) {
      onAccount();
      return;
    }

    alert("JustBrand Login page coming soon.");
  };

  // ==================================================
  // JUSTBRAND FAMILY
  // ==================================================

  const handleFamily = () => {
    closeMenu();

    if (onFamily) {
      onFamily();
      return;
    }
  };

  // ==================================================
  // WISHLIST
  // ==================================================

  const handleWishlist = () => {
    closeMenu();

    if (onWishlist) {
      onWishlist();
      return;
    }

    alert("Wishlist page coming soon.");
  };

  // ==================================================
  // ORDERS
  // ==================================================

  const handleOrders = () => {
    closeMenu();

    if (onOrders) {
      onOrders();
      return;
    }

    alert("Orders page coming soon.");
  };

  return (
    <>
      {/* ==================================================
          MAIN HEADER
      ================================================== */}

      <header className="jb-header">

        {/* LEFT SECTION */}
        <div className="jb-header-left">

          {/* MENU BUTTON */}
          <button
            className="jb-menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>

          {/* LOGO */}
          <div
            className="jb-logo"
            onClick={() => {
              setSearch("");
              closeMenu();
            }}
          >
            <img
              src="/images/logo.png"
              alt="JustBrand"
            />

            <span className="jb-logo-name">JustBrand</span>
          </div>
        </div>


        {/* ==================================================
            RIGHT SECTION
        ================================================== */}




        <div className="jb-header-right">

          {/* ACCOUNT */}

          <button
            className="jb-header-action"
            onClick={handleLogin}
          >
            <span className="jb-action-icon">
              👤
            </span>

            <span className="jb-action-text">
              Account
            </span>
          </button>


          {/* ==================================================
              SELL ON JUSTBRAND
          ================================================== */}

          {/* Sell on JustBrand: single entry lives in the side
             drawer (menu) — no duplicate CTA next to search. */}


          {/* WISHLIST */}

          <button
            className="jb-header-action"
            onClick={handleWishlist}
          >
            <span className="jb-action-icon">
              ❤️
            </span>

            <span className="jb-action-text">
              Wishlist
            </span>
          </button>


          {/* CART */}

          <button
            className="jb-cart-btn"
            onClick={onCart}
          >
            <span className="jb-cart-icon">
              🛒
            </span>

            <span className="jb-cart-text">
              Cart
            </span>

            {cartCount > 0 && (
              <span className="jb-cart-count">
                {cartCount}
              </span>
            )}
          </button>

        </div>

      </header>


      {/* STANDALONE SEARCH — directly below header */}
      <div className="jb-standalone-search-area">
        <div className="jb-search-wrapper jb-standalone-search">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Products, Brands and More" className="jb-search-input" aria-label="Search products, brands and more" />
          <button className="jb-search-btn" onClick={() => {}} aria-label="Search" type="button">🔍</button>
          {search && ((filteredProducts && filteredProducts.length > 0) || (filteredCategories && filteredCategories.length > 0)) && (
            <div className="jb-search-suggestions">
              {filteredCategories && filteredCategories.length > 0 && <div className="jb-suggestion-section"><div className="jb-suggestion-title">Categories</div>{filteredCategories.slice(0,5).map((category,index)=><div key={`category-${index}`} className="jb-suggestion-item" onClick={()=>handleCategory(category)}>📂 {category}</div>)}</div>}
              {filteredProducts && filteredProducts.length > 0 && <div className="jb-suggestion-section"><div className="jb-suggestion-title">Products</div>{filteredProducts.slice(0,8).map((product,index)=><div key={product.id||`product-${index}`} className="jb-suggestion-item jb-product-suggestion" onClick={()=>handleProductSelect(product)}><img src={product.image||"/images/product1.png"} alt={product.name||"Product"} onError={(e)=>{e.currentTarget.src="/images/product1.png";}}/><div><div className="jb-suggestion-product-name">{product.name}</div><div className="jb-suggestion-product-price">₹{product.price}</div></div></div>)}</div>}
            </div>
          )}
        </div>
      </div>

      {/* ==================================================
          SECOND NAVIGATION
      ================================================== */}

      <nav className="jb-nav">

        <div className="jb-nav-left">

          <button
            onClick={() => {
              setSearch("");
              closeMenu();
            }}
          >
            🏠 Home
          </button>

          <button
            onClick={() => handleCategory("Mobiles")}
          >
            📱 Mobiles
          </button>

          <button
            onClick={() => handleCategory("Fashion")}
          >
            👕 Fashion
          </button>

          <button
            onClick={() => handleCategory("Electronics")}
          >
            💻 Electronics
          </button>

          <button
            onClick={() => handleCategory("Beauty")}
          >
            💄 Beauty
          </button>

          <button
            onClick={() => handleCategory("Home")}
          >
            🏠 Home & Kitchen
          </button>

          <button
            onClick={() => handleCategory("Grocery")}
          >
            🛒 Grocery
          </button>

        </div>


        {/* Nav-level Sell CTA removed — the single "Sell on
            JustBrand" entry is in the side drawer (menu). */}

      </nav>


      {/* ==================================================
          SIDE DRAWER
      ================================================== */}

      {menuOpen && (

        <div
          className="jb-drawer-overlay"
          onClick={closeMenu}
        >

          <aside
            className="jb-side-drawer"
            onClick={(e) => e.stopPropagation()}
          >

            {/* DRAWER HEADER */}

            <div className="jb-side-header">

              <div className="jb-side-logo">
                <img
                  src="/images/logo.png"
                  alt="JustBrand"
                />

                <span>
                  JustBrand
                </span>
              </div>

              <button
                className="jb-side-close"
                onClick={closeMenu}
                aria-label="Close menu"
              >
                ✕
              </button>

            </div>


            {/* ACCOUNT */}

            <button
              className="jb-side-item"
              onClick={handleLogin}
            >
              👤
              <span>
                Login / Account
              </span>
            </button>


            {/* ORDERS */}

            <button
              className="jb-side-item"
              onClick={handleOrders}
            >
              📦
              <span>
                My Orders
              </span>
            </button>


            {/* WISHLIST */}

            <button
              className="jb-side-item"
              onClick={handleWishlist}
            >
              ❤️
              <span>
                Wishlist
              </span>
            </button>


            {/* ==================================================
                SELL ON JUSTBRAND
            ================================================== */}

            <button
              className="jb-side-item jb-side-seller"
              onClick={handleSeller}
              type="button"
            >
              🏪
              <span>
                Sell on JustBrand
              </span>
            </button>


            {/* ==================================================
                JUSTBRAND FAMILY
            ================================================== */}

            <button
              className="jb-side-item"
              onClick={handleFamily}
              type="button"
            >
              👨‍👩‍👦
              <span>
                JustBrand Family
              </span>
            </button>

            <button
              className="jb-side-item"
              onClick={handleFamily}
              type="button"
            >
              📝
              <span>
                JustBrand Join
              </span>
            </button>


            {/* CATEGORIES */}

            <div className="jb-side-section-title">
              Shop by Category
            </div>


            <button
              className="jb-side-item"
              onClick={() => handleCategory("Mobiles")}
            >
              📱
              <span>
                Mobiles
              </span>
            </button>


            <button
              className="jb-side-item"
              onClick={() => handleCategory("Fashion")}
            >
              👕
              <span>
                Fashion
              </span>
            </button>


            <button
              className="jb-side-item"
              onClick={() => handleCategory("Electronics")}
            >
              💻
              <span>
                Electronics
              </span>
            </button>


            <button
              className="jb-side-item"
              onClick={() => handleCategory("Beauty")}
            >
              💄
              <span>
                Beauty
              </span>
            </button>


            <button
              className="jb-side-item"
              onClick={() =>
                handleCategory("Home")
              }
            >
              🏠
              <span>
                Home & Kitchen
              </span>
            </button>


            <button
              className="jb-side-item"
              onClick={() =>
                handleCategory("Grocery")
              }
            >
              🛒
              <span>
                Grocery
              </span>
            </button>

          </aside>

        </div>
      )}


      {/* ==================================================
          CSS
      ================================================== */}

      <style>{`

        * {
          box-sizing: border-box;
        }


        /* ==================================================
           MAIN HEADER
        ================================================== */

        .jb-header {
          width: 100%;
          min-height: 70px;

          display: flex;
          align-items: center;
          flex-wrap: wrap;

          gap: 10px 15px;

          padding: 12px 20px 14px;

          background: linear-gradient(
            90deg,
            #ff7a00,
            #ff4d8d
          );

          color: white;

          position: sticky;
          top: 0;
          z-index: 1000;

          box-shadow:
            0 2px 8px rgba(0,0,0,0.18);
        }

        /* Tiranga identity: subtle tricolor strip under the header */
        .jb-header::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 3px;
          background: linear-gradient(
            90deg,
            #ff8c1a 0%,
            #ffa733 30%,
            #ffffff 50%,
            #2e9b0e 70%,
            #128807 100%
          );
          pointer-events: none;
        }


        /* ==================================================
           LEFT
        ================================================== */

        .jb-header-left {
          display: flex;
          align-items: center;
          gap: 12px;

          flex-shrink: 0;
        }


        .jb-menu-btn {
          width: 42px;
          height: 42px;

          border: none;
          border-radius: 8px;

          background: rgba(255,255,255,0.18);

          color: white;

          font-size: 23px;

          cursor: pointer;
        }


        .jb-menu-btn:hover {
          background: rgba(255,255,255,0.30);
        }


        /* ==================================================
           LOGO
        ================================================== */

        .jb-logo {
          display: flex;
          align-items: center;

          gap: 7px;

          cursor: pointer;

          white-space: nowrap;
        }


        .jb-logo img {
          width: 43px;
          height: 43px;

          object-fit: contain;

          border-radius: 8px;
        }


        .jb-logo span {
          font-size: 21px;
          font-weight: 800;
        }


        /* SEARCH BASE */
        .jb-search-wrapper { position: relative; width: 100%; }
        .jb-search-input { width: 100%; height: 48px; border: 1px solid #d9d9d9; outline: none; border-radius: 26px; padding: 0 58px 0 18px; font-size: 15px; color: #222; background: #fff; box-shadow: 0 3px 12px rgba(0,0,0,0.10); }
        .jb-search-input:focus { border-color: #ff7a00; box-shadow: 0 4px 16px rgba(255,122,0,0.18); }
        .jb-search-input::placeholder { color: #777; }
        .jb-search-btn { position: absolute; right: 5px; top: 5px; width: 38px; height: 38px; border: none; border-radius: 50%; background: linear-gradient(135deg,#ff7a00,#ff4d8d); color: white; cursor: pointer; font-size: 18px; }

        /* ==================================================
           RIGHT
        ================================================== */

        .jb-header-right {
          display: flex;
          align-items: center;

          gap: 8px;

          flex-shrink: 0;
        }


        /* TOP-ROW SEARCH RETIRED — search now lives in the lower nav row */
        .jb-search-wrapper {
          display: none;
        }


        .jb-header-action,
        .jb-cart-btn {
          border: none;

          background: transparent;

          color: white;

          cursor: pointer;

          display: flex;
          align-items: center;

          gap: 5px;

          padding: 8px;

          border-radius: 7px;

          position: relative;

          font-size: 14px;

          white-space: nowrap;
        }


        .jb-header-action:hover,
        .jb-cart-btn:hover {
          background:
            rgba(255,255,255,0.18);
        }


        .jb-action-icon,
        .jb-cart-icon {
          font-size: 20px;
        }


        /* ==================================================
           SELLER BUTTON
        ================================================== */

        /* jb-seller-top removed — single Sell entry is in the drawer. */

        /* ===== INFO PAGES (Contact / About / Return) ===== */

        .jb-info-card {
          background: var(--jb-card, #ffffff);

          border-radius: 12px;

          padding: 26px;

          margin-bottom: 18px;

          box-shadow: 0 2px 8px rgba(0,0,0,0.07);

          border: 1px solid rgba(0,0,0,0.05);
        }

        .jb-info-card h2 {
          margin: 0 0 12px;

          font-size: 20px;

          color: #1a1a1a;
        }

        .jb-info-card p,
        .jb-info-card li {
          color: #444;

          line-height: 1.7;

          font-size: 15px;
        }

        .jb-info-list {
          margin: 0;

          padding-left: 20px;
        }

        @media (max-width: 700px) {
          .jb-info-card {
            padding: 18px;
          }

          .jb-info-card h2 {
            font-size: 18px;
          }
        }

        /* ===== TRICOLOR HIGHLIGHT BAR (Tiranga accent) ===== */

        .jb-tricolor-bar {
          height: 4px;

          width: 72px;

          border-radius: 2px;

          margin: 0 0 14px;

          background: linear-gradient(
            90deg,
            var(--jb-saffron, #ff8c1a),
            #ffffff,
            var(--jb-green, #128807)
          );
        }


        /* ==================================================
           CART COUNT
        ================================================== */

        .jb-cart-count {
          position: absolute;

          top: 0;
          right: 0;

          min-width: 19px;
          height: 19px;

          display: flex;
          align-items: center;
          justify-content: center;

          border-radius: 50%;

          background: #ffe000;

          color: #222;

          font-size: 11px;

          font-weight: 800;
        }


        /* ==================================================
           SECOND NAV
        ================================================== */

        .jb-nav {
          width: 100%;

          min-height: 46px;

          display: flex;
          align-items: center;

          gap: 14px;

          padding:
            0 20px;

          background: white;

          border-bottom:
            1px solid #e5e5e5;

          box-shadow:
            0 1px 4px
            rgba(0,0,0,0.08);

          position: relative;

          z-index: 900;
        }


        .jb-nav-left {
          display: flex;
          align-items: center;

          gap: 4px;

          overflow-x: auto;

          order: 2;

          min-width: 0;
        }


        .jb-nav-left button {
          border: none;

          background: transparent;

          padding:
            10px 12px;

          color: #333;

          font-size: 14px;

          font-weight: 600;

          cursor: pointer;

          white-space: nowrap;

          border-radius: 5px;
        }


        .jb-nav-left button:hover {
          background: #fff1e7;

          color: #e85d00;
        }


        /* ==================================================
           NAV SELLER
        ================================================== */

        /* jb-nav-seller removed — Sell entry lives in the drawer. */


        /* ==================================================
           DRAWER OVERLAY
        ================================================== */

        .jb-drawer-overlay {
          position: fixed;

          inset: 0;

          background:
            rgba(0,0,0,0.48);

          z-index: 5000;
        }


        /* ==================================================
           SIDE DRAWER
        ================================================== */

        .jb-side-drawer {
          width: 330px;

          max-width: 88vw;

          height: 100%;

          background: white;

          box-shadow:
            5px 0 20px
            rgba(0,0,0,0.20);

          overflow-y: auto;

          animation:
            jbDrawerIn 0.22s ease;
        }


        @keyframes jbDrawerIn {
          from {
            transform: translateX(-100%);
          }

          to {
            transform: translateX(0);
          }
        }


        /* ==================================================
           DRAWER HEADER
        ================================================== */

        .jb-side-header {
          height: 70px;

          display: flex;
          align-items: center;

          justify-content: space-between;

          padding:
            10px 15px;

          background:
            linear-gradient(
              90deg,
              #ff7a00,
              #ff4d8d
            );

          color: white;
        }


        .jb-side-logo {
          display: flex;
          align-items: center;

          gap: 8px;

          font-size: 20px;

          font-weight: 800;
        }


        .jb-side-logo img {
          width: 40px;
          height: 40px;

          object-fit: contain;

          border-radius: 7px;
        }


        .jb-side-close {
          width: 38px;
          height: 38px;

          border: none;

          background:
            rgba(255,255,255,0.18);

          color: white;

          border-radius: 7px;

          font-size: 20px;

          cursor: pointer;
        }


        /* ==================================================
           DRAWER ITEMS
        ================================================== */

        .jb-side-item {
          width: 100%;

          display: flex;
          align-items: center;

          gap: 14px;

          padding:
            14px 18px;

          border: none;

          border-bottom:
            1px solid #eeeeee;

          background: white;

          color: #333;

          text-align: left;

          font-size: 15px;

          font-weight: 600;

          cursor: pointer;
        }


        .jb-side-item:hover {
          background: #fff5ee;

          color: #e85d00;
        }


        /* ==================================================
           SIDE SELLER
        ================================================== */

        .jb-side-seller {
          background:
            linear-gradient(
              90deg,
              #fff3e8,
              #fff0f5
            );

          color: #e85d00;

          font-weight: 800;
        }


        .jb-side-seller:hover {
          background:
            linear-gradient(
              90deg,
              #ffe4d0,
              #ffe3ee
            );
        }


        /* ==================================================
           SECTION TITLE
        ================================================== */

        .jb-side-section-title {
          padding:
            18px 18px 8px;

          font-size: 12px;

          color: #888;

          font-weight: 800;

          text-transform: uppercase;

          letter-spacing: 0.5px;
        }


        /* ==================================================
           TABLET
        ================================================== */

        @media (max-width: 1100px) {

          .jb-header {
            padding:
              9px 12px;

            gap: 10px;
          }


          .jb-action-text,
          .jb-cart-text {
            display: none;
          }


          .jb-header-right {
            gap: 3px;
          }


          .jb-nav {
            gap:
              10px;

            padding:
              0 10px;
          }


          .jb-nav-seller { display: none; }


          .jb-nav-left button {
            padding:
              9px 8px;

            font-size: 13px;
          }

        }


        /* ==================================================
           MOBILE
        ================================================== */

        @media (max-width: 700px) {

          .jb-header {
            min-height: auto;

            padding:
              8px;

            display: grid;

            grid-template-columns:
              auto 1fr auto;

            gap: 7px;
          }


          .jb-header-right {
            flex-wrap: nowrap;
          }


          .jb-header-left {
            gap: 5px;
          }


          .jb-menu-btn {
            width: 38px;
            height: 38px;

            font-size: 20px;
          }


          .jb-logo {
            gap: 6px;

            justify-self: start;
          }


          .jb-logo img {
            width: 34px;
            height: 34px;
          }


          .jb-logo span.jb-logo-name {
            display: inline-block;

            font-size: 15px;

            font-weight: 800;

            line-height: 1.1;
          }


          .jb-search-wrapper {
            display: block;
          }


          .jb-nav-search .jb-search-suggestions {
            width: 200%;
          }


          .jb-standalone-search-area { padding: 8px 9px; }
          .jb-search-wrapper.jb-standalone-search { max-width: none; }
          .jb-standalone-search .jb-search-input { height: 44px; font-size: 14px; padding-left: 15px; }
          .jb-standalone-search .jb-search-btn { width: 36px; height: 36px; top: 4px; right: 4px; }

          .jb-header-right {
            gap: 2px;
          }


          .jb-header-action {
            padding: 5px;
          }


          .jb-action-icon {
            font-size: 18px;
          }


          .jb-seller-top {
            display: none;
          }


          .jb-cart-btn {
            padding: 5px;
          }


          .jb-cart-icon {
            font-size: 20px;
          }


          .jb-nav {
            padding:
              0 5px;

            flex-wrap: wrap;

            overflow: visible;

            row-gap: 6px;
          }


          .jb-nav-left {
            order: 3;

            flex: 0 0 100%;

            width: max-content;

            gap: 0;
          }


          .jb-nav-left button {
            padding:
              9px 9px;

            font-size: 12px;
          }


          /* jb-nav-seller rules removed — element is gone. */


          .jb-side-drawer {
            width: 300px;
          }

        }


        /* ==================================================
           SMALL MOBILE
        ================================================== */

        @media (max-width: 420px) {

          .jb-menu-btn {
            width: 35px;
            height: 35px;
          }


          .jb-logo img {
            width: 35px;
            height: 35px;
          }


          .jb-search-input {
            height: 36px;
          }


          /* jb-nav-seller rules removed — element is gone. */


          .jb-search-btn {
            width: 29px;
            height: 29px;
          }


          .jb-header-action {
            padding: 3px;
          }


          .jb-cart-btn {
            padding: 3px;
          }

        }

      `}</style>
    </>
  );
}

export default Header;


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

            <span>JustBrand</span>
          </div>
        </div>


        {/* ==================================================
            SEARCH BAR
        ================================================== */}

        <div className="jb-search-wrapper">

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Products, Brands and More"
            className="jb-search-input"
          />

          <button
            className="jb-search-btn"
            onClick={() => {
              // Search already controlled by App.jsx
            }}
            aria-label="Search"
          >
            🔍
          </button>


          {/* SEARCH SUGGESTIONS */}

          {search &&
            (
              (filteredProducts && filteredProducts.length > 0) ||
              (filteredCategories && filteredCategories.length > 0)
            ) && (

              <div className="jb-search-suggestions">

                {/* CATEGORIES */}

                {filteredCategories &&
                  filteredCategories.length > 0 && (

                    <div className="jb-suggestion-section">

                      <div className="jb-suggestion-title">
                        Categories
                      </div>

                      {filteredCategories
                        .slice(0, 5)
                        .map((category, index) => (

                          <div
                            key={`category-${index}`}
                            className="jb-suggestion-item"
                            onClick={() =>
                              handleCategory(category)
                            }
                          >
                            📂 {category}
                          </div>

                        ))}
                    </div>
                  )}


                {/* PRODUCTS */}

                {filteredProducts &&
                  filteredProducts.length > 0 && (

                    <div className="jb-suggestion-section">

                      <div className="jb-suggestion-title">
                        Products
                      </div>

                      {filteredProducts
                        .slice(0, 8)
                        .map((product, index) => (

                          <div
                            key={
                              product.id ||
                              `product-${index}`
                            }
                            className="jb-suggestion-item jb-product-suggestion"
                            onClick={() =>
                              handleProductSelect(product)
                            }
                          >

                            <img
                              src={
                                product.image ||
                                "/images/product1.png"
                              }
                              alt={product.name || "Product"}
                              onError={(e) => {
                                e.currentTarget.src =
                                  "/images/product1.png";
                              }}
                            />

                            <div>
                              <div className="jb-suggestion-product-name">
                                {product.name}
                              </div>

                              <div className="jb-suggestion-product-price">
                                ₹{product.price}
                              </div>
                            </div>

                          </div>

                        ))}
                    </div>
                  )}

              </div>
            )}
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

          <button
            className="jb-seller-top"
            onClick={handleSeller}
            type="button"
          >
            <span className="jb-seller-icon">
              🏪
            </span>

            <span>
              Sell on JustBrand
            </span>
          </button>


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


        {/* SELLER NAV BUTTON */}

        <button
          className="jb-nav-seller"
          onClick={handleSeller}
          type="button"
        >
          🏪 Sell on JustBrand
        </button>

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

          gap: 15px;

          padding: 10px 20px;

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


        /* ==================================================
           SEARCH
        ================================================== */

        .jb-search-wrapper {
          position: relative;

          flex: 1;

          max-width: 850px;

          margin: 0 auto;
        }


        .jb-search-input {
          width: 100%;

          height: 44px;

          border: none;
          outline: none;

          border-radius: 7px;

          padding:
            0 52px 0 16px;

          font-size: 15px;

          color: #222;
        }


        .jb-search-input::placeholder {
          color: #777;
        }


        .jb-search-btn {
          position: absolute;

          right: 4px;
          top: 4px;

          width: 36px;
          height: 36px;

          border: none;
          border-radius: 6px;

          background: #ff7a00;

          color: white;

          cursor: pointer;

          font-size: 18px;
        }


        /* ==================================================
           SEARCH SUGGESTIONS
        ================================================== */

        .jb-search-suggestions {
          position: absolute;

          top: 49px;
          left: 0;
          right: 0;

          background: white;

          color: #222;

          border-radius: 8px;

          box-shadow:
            0 5px 20px rgba(0,0,0,0.20);

          max-height: 430px;

          overflow-y: auto;

          z-index: 2000;
        }


        .jb-suggestion-section {
          padding: 8px 0;
        }


        .jb-suggestion-title {
          padding:
            7px 15px;

          font-size: 12px;

          font-weight: 700;

          color: #777;

          text-transform: uppercase;
        }


        .jb-suggestion-item {
          display: flex;
          align-items: center;

          gap: 10px;

          padding:
            9px 15px;

          cursor: pointer;

          transition:
            background 0.15s ease;
        }


        .jb-suggestion-item:hover {
          background: #f5f5f5;
        }


        .jb-product-suggestion img {
          width: 42px;
          height: 42px;

          object-fit: contain;

          border-radius: 5px;

          border: 1px solid #eee;
        }


        .jb-suggestion-product-name {
          font-size: 14px;
          font-weight: 600;
        }


        .jb-suggestion-product-price {
          font-size: 13px;

          color: #e85d00;

          margin-top: 2px;
        }


        /* ==================================================
           RIGHT
        ================================================== */

        .jb-header-right {
          display: flex;
          align-items: center;

          gap: 8px;

          flex-shrink: 0;
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

        .jb-seller-top {
          display: flex;
          align-items: center;

          gap: 6px;

          padding:
            9px 12px;

          border: 1px solid
            rgba(255,255,255,0.45);

          border-radius: 7px;

          background: white;

          color: #e85d00;

          font-weight: 700;

          cursor: pointer;

          white-space: nowrap;

          transition:
            all 0.2s ease;
        }


        .jb-seller-top:hover {
          transform: translateY(-1px);

          box-shadow:
            0 3px 10px
            rgba(0,0,0,0.18);
        }


        .jb-seller-icon {
          font-size: 18px;
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

          justify-content: space-between;

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

        .jb-nav-seller {
          border: none;

          background:
            linear-gradient(
              90deg,
              #ff7a00,
              #ff4d8d
            );

          color: white;

          font-weight: 700;

          padding:
            9px 14px;

          border-radius: 6px;

          cursor: pointer;

          white-space: nowrap;

          margin-left: 10px;
        }


        .jb-nav-seller:hover {
          opacity: 0.92;

          transform: translateY(-1px);
        }


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


          .jb-seller-top {
            padding:
              8px 9px;

            font-size: 12px;
          }


          .jb-nav {
            padding:
              0 10px;
          }


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


          .jb-header-left {
            gap: 5px;
          }


          .jb-menu-btn {
            width: 38px;
            height: 38px;

            font-size: 20px;
          }


          .jb-logo span {
            display: none;
          }


          .jb-logo img {
            width: 39px;
            height: 39px;
          }


          .jb-search-wrapper {
            width: 100%;
          }


          .jb-search-input {
            height: 39px;

            font-size: 13px;

            padding-left: 10px;
          }


          .jb-search-btn {
            width: 32px;
            height: 32px;

            top: 3.5px;
            right: 3.5px;
          }


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

            overflow-x: auto;

            justify-content: flex-start;
          }


          .jb-nav-left {
            width: max-content;

            gap: 0;
          }


          .jb-nav-left button {
            padding:
              9px 9px;

            font-size: 12px;
          }


          .jb-nav-seller {
            display: none;
          }


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

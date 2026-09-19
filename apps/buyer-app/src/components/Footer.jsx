import React from "react";

// ==========================================
// JUSTBRAND FOOTER (text-only brand)
// No logo image here by design — the JustBrand
// wordmark is the brand anchor in the footer.
// Admin-managed content links open the same
// info pages as before; all functionality is
// preserved, only the presentation is upgraded.
// ==========================================

function Footer({ onInfoPage, onFamily, onCart, onWishlist }) {
  const goTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <footer className="jb-footer">
      <style>{`
        .jb-footer {
          background: linear-gradient(180deg, #0b1f4b 0%, #071638 100%);
          color: #e9edf7;
          margin-top: 40px;
        }
        .jb-footer-main {
          max-width: 1200px;
          margin: 0 auto;
          padding: 38px 20px 26px;
          display: grid;
          grid-template-columns: 1.4fr 1fr 1fr 1fr;
          gap: 28px;
          box-sizing: border-box;
        }
        .jb-footer-brand-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .jb-footer-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.01em;
          background: linear-gradient(90deg, #ffb347, #ff6b00, #ff1493);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .jb-footer-tagline {
          font-size: 12.5px;
          color: #b8c4de;
          margin-top: 2px;
        }
        .jb-footer-brand p {
          margin: 8px 0 0;
          font-size: 13.5px;
          line-height: 1.55;
          color: #b8c4de;
          max-width: 320px;
        }
        .jb-footer-column h3 {
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: #ffb347;
          margin: 6px 0 12px;
        }
        .jb-footer-column button,
        .jb-footer-column a {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: #d5ddef;
          font-size: 14px;
          padding: 7px 0;
          cursor: pointer;
          text-decoration: none;
          transition: color 0.15s ease, transform 0.15s ease;
        }
        .jb-footer-column button:hover,
        .jb-footer-column a:hover {
          color: #ffb347;
          transform: translateX(2px);
        }
        .jb-footer-bottom {
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          max-width: 1200px;
          margin: 0 auto;
          padding: 16px 20px 22px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px 22px;
          align-items: center;
          justify-content: space-between;
          font-size: 12.5px;
          color: #9fb0d4;
          box-sizing: border-box;
        }
        @media (max-width: 860px) {
          .jb-footer-main {
            grid-template-columns: 1fr 1fr;
            padding: 30px 16px 20px;
          }
        }
        @media (max-width: 560px) {
          .jb-footer-main {
            grid-template-columns: 1fr;
            gap: 18px;
            padding: 26px 16px 16px;
          }
          .jb-footer-column button,
          .jb-footer-column a {
            padding: 10px 0;
            font-size: 15px;
          }
          .jb-footer-bottom {
            flex-direction: column;
            gap: 6px;
            text-align: center;
          }
        }
      `}</style>

      <div className="jb-footer-main">
        <div className="jb-footer-brand">
          <div className="jb-footer-brand-row">
            <div>
              <div className="jb-footer-title">JustBrand</div>
              <div className="jb-footer-tagline">
                Shop smart • Earn smart • Grow together
              </div>
            </div>
          </div>
          <p>
            भारत का अपना marketplace — shopping, selling और growing together.
          </p>
        </div>
        <div className="jb-footer-column">
          <h3>Company</h3>
          <button onClick={() => onInfoPage?.("about")}>About Us</button>
          <button onClick={() => onInfoPage?.("contact")}>Contact Us</button>
          <button onClick={() => onInfoPage?.("returns")}>
            Return & Refund Policy
          </button>
        </div>
        <div className="jb-footer-column">
          <h3>Quick Links</h3>
          <button onClick={goTop}>Shop Now</button>
          <button onClick={() => onCart?.()}>My Cart</button>
          <button onClick={() => onWishlist?.()}>Wishlist</button>
        </div>
        <div className="jb-footer-column">
          <h3>JustBrand Family</h3>
          <button onClick={() => onFamily?.()}>JustBrand Family</button>
          <a href="https://seller.justbrand.in/">Sell on JustBrand</a>
          <button onClick={goTop}>Back to Top ↑</button>
        </div>
      </div>
      <div className="jb-footer-bottom">
        <span>🇮🇳 Made for India</span>
        <span>Secure shopping experience</span>
        <span>© {new Date().getFullYear()} JustBrand</span>
      </div>
    </footer>
  );
}

export default Footer;

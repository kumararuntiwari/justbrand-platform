import React from "react";

// ==========================================
// JUSTBRAND FOOTER (text-only brand)
// No logo image here by design — the JustBrand
// wordmark is the brand anchor in the footer.
// Admin-managed content links open the same
// info pages as before; all functionality is
// preserved, only the presentation is upgraded.
//
// Phase 1: admin-editable copy comes from the
// site_footer setting (via `content` prop). Every
// field falls back to the hardcoded defaults below
// when the setting is missing/inactive — so the
// footer never goes blank.
// ==========================================

function Footer({ onInfoPage, onFamily, onCart, onWishlist, content }) {
  const goTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Admin-controlled values with built-in fallbacks.
  const custom = content && content.active !== false;
  const heading = custom && content.heading ? content.heading : "JustBrand";
  const description =
    custom && content.description
      ? content.description
      : "भारत का अपना marketplace — shopping, selling और growing together.";
  const aboutText = custom && content.aboutText ? content.aboutText : "About Us";
  const contactText =
    custom && content.contactText ? content.contactText : "Contact Us";
  const returnPolicyText =
    custom && content.returnPolicyText
      ? content.returnPolicyText
      : "Return & Refund Policy";
  const deliveryPolicyText =
    custom && content.deliveryPolicyText
      ? content.deliveryPolicyText
      : "Shipping & Delivery Policy";
  const privacyText =
    custom && content.privacyText ? content.privacyText : "Privacy Policy";
  const termsText =
    custom && content.termsText ? content.termsText : "Terms & Conditions";
  const familyText =
    custom && content.familyText ? content.familyText : "JustBrand Family";
  const showFamily = !custom || content.showFamily !== false;
  const copyright =
    custom && content.copyright
      ? content.copyright
      : `© ${new Date().getFullYear()} JustBrand`;

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
              <div className="jb-footer-title">{heading}</div>
              <div className="jb-footer-tagline">
                Shop smart • Earn smart • Grow together
              </div>
            </div>
          </div>
          <p>{description}</p>
        </div>
        <div className="jb-footer-column">
          <h3>Company</h3>
          <button onClick={() => onInfoPage?.("about")}>{aboutText}</button>
          <button onClick={() => onInfoPage?.("contact")}>{contactText}</button>
          <button onClick={() => onInfoPage?.("returns")}>
            {returnPolicyText}
          </button>
          <button onClick={() => onInfoPage?.("shipping")}>
            {deliveryPolicyText}
          </button>
        </div>
        <div className="jb-footer-column">
          <h3>Quick Links</h3>
          <button onClick={goTop}>Shop Now</button>
          <button onClick={() => onCart?.()}>My Cart</button>
          <button onClick={() => onWishlist?.()}>Wishlist</button>
          <button onClick={() => onInfoPage?.("privacy")}>{privacyText}</button>
          <button onClick={() => onInfoPage?.("terms")}>{termsText}</button>
        </div>
        <div className="jb-footer-column">
          <h3>JustBrand Family</h3>
          {showFamily ? (
            <button onClick={() => onFamily?.()}>{familyText}</button>
          ) : null}
          <a href="https://seller.justbrand.in/">Sell on JustBrand</a>
          <button onClick={goTop}>Back to Top ↑</button>
        </div>
      </div>
      <div className="jb-footer-bottom">
        <span>🇮🇳 Made for India</span>
        <span>Secure shopping experience</span>
        <span>{copyright}</span>
      </div>
    </footer>
  );
}

export default Footer;

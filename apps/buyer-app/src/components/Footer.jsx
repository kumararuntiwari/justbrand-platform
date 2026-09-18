import React from "react";

function Footer({ onInfoPage, onFamily, onCart, onWishlist }) {
  const goTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <footer className="jb-footer">
      <div className="jb-footer-main">
        <div className="jb-footer-brand">
          <div className="jb-footer-brand-row">
            <img src="/images/logo.png" alt="JustBrand" className="jb-footer-logo" />
            <div>
              <div className="jb-footer-title">JustBrand</div>
              <div className="jb-footer-tagline">Shop smart • Earn smart • Grow together</div>
            </div>
          </div>
          <p>भारत का अपना marketplace — shopping, selling और growing together.</p>
        </div>
        <div className="jb-footer-column">
          <h3>Company</h3>
          <button onClick={() => onInfoPage?.("about")}>About Us</button>
          <button onClick={() => onInfoPage?.("contact")}>Contact Us</button>
          <button onClick={() => onInfoPage?.("returns")}>Return & Refund Policy</button>
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

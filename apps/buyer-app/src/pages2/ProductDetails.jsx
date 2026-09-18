import React, { useState, useEffect } from "react";

function ProductDetails({ product, addToCart, onBack, onBuyNow }) {
  // Mobile: gallery stacks above the details (vertical hierarchy).
  // Desktop: gallery left, details right. Desktop layout is unchanged.
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth <= 768
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!product) {
    return null;
  }

  const sellerPrice = product.price;
  const price = product.customerPrice ?? sellerPrice;
  const mrp = product.comparePrice || product.oldPrice || product.mrp;

  // Discount % derived from the product's own price fields (display only).
  const priceNum = Number(String(price || "0").replace(/[^0-9.]/g, ""));
  const mrpNum = Number(String(mrp || "0").replace(/[^0-9.]/g, ""));
  const discountPercent =
    mrpNum > priceNum && priceNum > 0
      ? Math.round(((mrpNum - priceNum) / mrpNum) * 100)
      : 0;

  const rating = product.rating || 4.5;
  const trustedSeller = product.trustedSeller !== false;

  return (
    <div
      className="jb-page"
      style={{
        minHeight: "100vh",
        padding: isMobile ? "12px" : "20px",
      }}
    >
      {/* BACK BUTTON */}
      <button
        onClick={onBack}
        style={{
          background: "#333",
          color: "white",
          border: "none",
          padding: "10px 18px",
          borderRadius: "8px",
          cursor: "pointer",
          marginBottom: "20px",
        }}
      >
        ← Back
      </button>

      {/* PRODUCT DETAILS CARD */}
      {/* Mobile: one column (gallery on top, details below).
          Desktop: two columns (gallery left, details right). */}
      <div
        style={{
          maxWidth: "1000px",
          margin: "auto",
          background: "white",
          borderRadius: "15px",
          padding: isMobile ? "16px" : "25px",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? "20px" : "30px",
          boxShadow: "0 2px 10px #ddd",
          boxSizing: "border-box",
        }}
      >
        {/* PRODUCT IMAGE / GALLERY — always first: full image, never cropped */}
        <div
          style={{
            height: isMobile ? "390px" : "400px",
            background: "#f8f8f8",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            width: "100%",
          }}
        >
          <img
            src={product.image}
            alt={product.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: "8px",
              boxSizing: "border-box",
              borderRadius: "12px",
            }}
          />
        </div>

        {/* PRODUCT INFORMATION */}
        <div
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <p
            style={{
              color: "#777",
              margin: "0 0 8px",
              fontSize: "14px",
            }}
          >
            {product.category}
          </p>

          <h1
            style={{
              fontSize: isMobile ? "22px" : "30px",
              marginTop: "0",
              marginBottom: "10px",
              lineHeight: "1.3",
              overflowWrap: "anywhere",
            }}
          >
            {product.name}
          </h1>

          {/* RATING + TRUSTED SELLER */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "12px",
            }}
          >
            <span
              style={{
                background: "#f5a623",
                color: "white",
                padding: "3px 8px",
                borderRadius: "5px",
                fontSize: "13px",
                fontWeight: "bold",
              }}
            >
              ★ {rating}
            </span>
            <span style={{ fontSize: "13px", color: "#777" }}>Rating</span>

            {trustedSeller && (
              <span
                style={{
                  color: "#168a3a",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                ✓ Trusted Seller
              </span>
            )}
          </div>

          {/* PRICE / MRP / DISCOUNT */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontSize: isMobile ? "26px" : "30px",
                fontWeight: "bold",
                color: "#ff6b00",
              }}
            >
              {price}
            </span>

            {mrp && mrpNum > priceNum ? (
              <span
                style={{
                  color: "#888",
                  textDecoration: "line-through",
                  fontSize: "17px",
                }}
              >
                {mrp}
              </span>
            ) : null}

            {discountPercent > 0 && (
              <span
                style={{
                  background: "#fff0f0",
                  color: "#d32f2f",
                  padding: "3px 8px",
                  borderRadius: "5px",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
              >
                {discountPercent}% OFF
              </span>
            )}
          </div>

          {product.customerPrice !== undefined && (
            <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", marginBottom: "16px", fontSize: "13px", color: "#555" }}>
              <strong>Price includes:</strong> delivery ₹{Number(product.deliveryCharge || 0).toFixed(2)} ·
              platform ₹{Number(product.platformCharge || 0).toFixed(2)} ·
              JustBrand Family ₹{Number(product.mlmCommission || 0).toFixed(2)} ·
              GST {Number(product.gstRate || 0)}%
              <div style={{ marginTop: "7px", color: "#777" }}>
                Seller price: ₹{Number(String(sellerPrice || 0).replace(/[^0-9.]/g, "")).toLocaleString("en-IN")}
              </div>
            </div>
          )}

          {/* OFFER */}
          <div
            style={{
              background: "#fff3e8",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "16px",
              color: "#e85d00",
              fontWeight: "bold",
              fontSize: "14px",
            }}
          >
            🔥 Special Offer Available
          </div>

          {/* SELLER + DETAILS */}
          {product.sellerName && (
            <p style={{ color: "#666", fontSize: "14px", margin: "0 0 10px" }}>
              Sold by: <strong>{product.sellerName}</strong>
            </p>
          )}

          {(product.shortDetails || product.description) && (
            <p
              style={{
                color: "#555",
                lineHeight: "1.6",
                marginTop: 0,
                overflowWrap: "anywhere",
              }}
            >
              {product.shortDetails || product.description}
            </p>
          )}

          {/* ACTION BUTTONS */}
          <div
            style={{
              marginTop: "auto",
              paddingTop: isMobile ? "8px" : "16px",
            }}
          >
            {/* ADD TO CART */}
            <button
              onClick={() => addToCart(product)}
              style={{
                width: "100%",
                background: "#ff6b00",
                color: "white",
                border: "none",
                padding: "15px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "17px",
                fontWeight: "bold",
              }}
            >
              🛒 Add to Cart
            </button>

            {/* BUY NOW — direct checkout of THIS product only.
                Never adds the product to the cart. */}
            <button
              onClick={() => onBuyNow && onBuyNow(product)}
              style={{
                width: "100%",
                background: "#ff9f00",
                color: "white",
                border: "none",
                padding: "15px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "17px",
                fontWeight: "bold",
                marginTop: "12px",
              }}
            >
              ⚡ Buy Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductDetails;

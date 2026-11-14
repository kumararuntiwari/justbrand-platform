import { useState, useEffect } from "react";

// =====================================================
// PRODUCT DETAIL PAGE (shared by the URL route /product/:id and
// the legacy state-based flow)
// =====================================================
// Data honesty rules (Feature 4B): nothing is invented. Rating shows
// only when the backend actually provides one; the Trusted-Seller
// badge only when the product carries trustedSeller === true; the
// delivery-charge line only when the product has a real charge.
// There is no stock/ETA/variant data in the backend, so none is
// displayed. Discount % is derived strictly from real price fields.

const DEFAULT_FALLBACK_IMAGE = "/images/product1.png";
const MAX_QUANTITY = 10;

function ProductDetails({
  product,
  addToCart,
  addToWishlist,
  isWishlisted,
  fallbackImage,
  onBack,
  onBuyNow,
  onChat,
}) {
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

  // IMAGE GALLERY state (additive). Hooks must sit above the early
  // `if (!product) return null` return — React hooks order rules.
  const [activeImage, setActiveImage] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  // TOUCH SWIPE start position for the main image (mobile gallery
  // navigation). Declared with the other hooks — never below the
  // early `if (!product)` return (rules of hooks).
  const [touchStartX, setTouchStartX] = useState(null);
  // IMAGE FALLBACK CHAIN: gallery URLs that failed to load. A broken
  // slide is skipped (the next own image is shown); the generic local
  // placeholder appears only when EVERY own image failed — never
  // silently replacing a single broken URL with a wrong product photo.
  const [brokenImages, setBrokenImages] = useState([]);

  // Reset the selected slide/quantity when the product changes (URL
  // navigation back → another product) so the gallery always opens
  // on the primary image with quantity 1.
  useEffect(() => {
    setActiveImage(0);
    setQuantity(1);
    setZoomOpen(false);
    setBrokenImages([]);
  }, [product?.id]);

  // Build the gallery BEFORE the key handlers so the listeners know
  // the current slide count.
  const gallery =
    Array.isArray(product?.images) && product.images.length > 0
      ? product.images.filter(Boolean)
      : [product?.image].filter(Boolean);

  const safeIndex =
    product && gallery.length > 0
      ? Math.min(activeImage, gallery.length - 1)
      : 0;

  // KEYBOARD: ← / → switch slides (multi-image only), Esc closes zoom.
  useEffect(() => {
    function handleKey(event) {
      if (!product || gallery.length < 2) {
        if (event.key === "Escape") setZoomOpen(false);
        return;
      }

      if (event.key === "ArrowLeft") {
        setActiveImage((prev) => {
          const current = Math.min(prev, gallery.length - 1);
          return (current - 1 + gallery.length) % gallery.length;
        });
      } else if (event.key === "ArrowRight") {
        setActiveImage((prev) => {
          const current = Math.min(prev, gallery.length - 1);
          return (current + 1) % gallery.length;
        });
      } else if (event.key === "Escape") {
        setZoomOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [product, gallery.length]);

  if (!product) {
    return null;
  }

  const sellerPrice = product.price;
  const price = product.customerPrice ?? sellerPrice;
  const mrp = product.comparePrice || product.oldPrice || product.mrp;

  // Discount % derived from the product's own price fields (display only).
  const priceNum = Number(String(price || "0").replace(/[^0-9.]/g, "")) || 0;
  const mrpNum = Number(String(mrp || "0").replace(/[^0-9.]/g, "")) || 0;
  const discountPercent =
    mrpNum > priceNum && priceNum > 0
      ? Math.round(((mrpNum - priceNum) / mrpNum) * 100)
      : 0;

  // REAL DATA ONLY: the backend has no rating/review columns, so the
  // rating chip renders only when a genuine numeric rating is present.
  const ratingNum = Number(product.rating);
  const hasRating = Number.isFinite(ratingNum) && ratingNum > 0;

  // Trusted-Seller badge only when the data explicitly says so.
  const trustedSeller = product.trustedSeller === true;

  // DISPLAY-ONLY: the internal charge amounts (delivery / platform /
  // JustBrand Family) are intentionally NOT rendered to customers.
  // The underlying product fields are untouched — prices and totals
  // still come from the backend exactly as before.

  const hasMultipleImages = gallery.length > 1;
  const imgFallback = fallbackImage || DEFAULT_FALLBACK_IMAGE;

  // IMAGE FALLBACK CHAIN: remember failed URLs; when the visible
  // slide fails, advance to the next own image that still works.
  const markImageBroken = (index) => {
    const src = gallery[index];

    if (!src || brokenImages.includes(src)) return;

    setBrokenImages((prev) => [...prev, src]);
  };

  const handleImageError = (index) => {
    markImageBroken(index);

    // Only the visible slide drives the gallery forward; a broken
    // thumbnail simply renders as an "unavailable" tile.
    if (index !== safeIndex) return;

    for (let i = safeIndex + 1; i < gallery.length; i += 1) {
      if (!brokenImages.includes(gallery[i])) {
        setActiveImage(i);
        return;
      }
    }
  };

  // Last resort: every own image failed → generic local placeholder.
  const allGalleryImagesBroken =
    gallery.length > 0 &&
    gallery.every((src) => brokenImages.includes(src));

  const mainImage =
    (allGalleryImagesBroken ? imgFallback : gallery[safeIndex]) || "";

  const wished = Boolean(isWishlisted);

  const goToPrev = () =>
    setActiveImage((safeIndex - 1 + gallery.length) % gallery.length);
  const goToNext = () => setActiveImage((safeIndex + 1) % gallery.length);

  // TOUCH SWIPE handlers on the main image (mobile gallery navigation).
  function handleTouchStart(event) {
    setTouchStartX(event.changedTouches[0].clientX);
  }
  function handleTouchEnd(event) {
    if (touchStartX === null || gallery.length < 2) return;
    const delta = event.changedTouches[0].clientX - touchStartX;
    setTouchStartX(null);
    if (Math.abs(delta) < 40) return; // ignore tiny drags
    if (delta > 0) goToPrev();
    else goToNext();
  }

  const clampQuantity = (value, max = MAX_QUANTITY) =>
    Math.max(1, Math.min(max, Number(value) || 1));

  // LIMITED STOCK TRACKING: only the backend's explicit
  // `inStock === false` marks a product unavailable (tracked stock
  // hit 0). Untracked products keep the normal flow. The quantity
  // selector also never exceeds the tracked stock count, so the
  // buyer cannot request more than exists.
  const outOfStock = product?.inStock === false;
  const trackedStock =
    product?.stock === null || product?.stock === undefined
      ? null
      : Number(product.stock);
  const maxQuantity =
    trackedStock === null
      ? MAX_QUANTITY
      : Math.max(1, Math.min(MAX_QUANTITY, trackedStock));

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
        type="button"
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
          maxWidth: "1180px",
          margin: "auto",
          background: "white",
          borderRadius: "15px",
          padding: isMobile ? "16px" : "25px",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1.15fr 0.85fr",
          gap: isMobile ? "20px" : "30px",
          boxShadow: "0 2px 10px #ddd",
          boxSizing: "border-box",
        }}
      >
        {/* PRODUCT IMAGE / GALLERY — always first: full image, never
            cropped (Fit to Cell / contain). Multi-image products get a
            slider with thumbnails, arrows, swipe and keyboard control;
            clicking the main image opens the zoom overlay. */}
        <div>
          <div
            style={{
              height: isMobile ? "450px" : "520px",
              background: "#f8f8f8",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              width: "100%",
              position: "relative",
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <img
              src={mainImage}
              alt={product.name}
              data-testid="pdp-main-image"
              onClick={() => mainImage && setZoomOpen(true)}
              onError={() => handleImageError(safeIndex)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                padding: "8px",
                boxSizing: "border-box",
                borderRadius: "12px",
                cursor: mainImage ? "zoom-in" : "default",
              }}
            />

            {hasMultipleImages && (
              <>
                {/* prev / next arrows */}
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={goToPrev}
                  style={{
                    position: "absolute",
                    left: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.92)",
                    color: "#333",
                    fontSize: "17px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={goToNext}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.92)",
                    color: "#333",
                    fontSize: "17px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                  }}
                >
                  ›
                </button>

                {/* image counter */}
                <span
                  style={{
                    position: "absolute",
                    bottom: "8px",
                    right: "10px",
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "999px",
                  }}
                >
                  {safeIndex + 1} / {gallery.length}
                </span>

                {/* zoom hint */}
                <span
                  style={{
                    position: "absolute",
                    bottom: "8px",
                    left: "10px",
                    background: "rgba(0,0,0,0.45)",
                    color: "#fff",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "999px",
                  }}
                >
                  Click image to zoom
                </span>
              </>
            )}
          </div>

          {/* thumbnails (multi-image only) */}
          {hasMultipleImages && (
            <div
              style={{
                display: "flex",
                gap: "8px",
                marginTop: "10px",
                overflowX: "auto",
                paddingBottom: "4px",
              }}
            >
              {gallery.map((src, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`View image ${index + 1}`}
                  aria-pressed={index === safeIndex}
                  onClick={() => setActiveImage(index)}
                  style={{
                    flex: "0 0 auto",
                    width: isMobile ? "52px" : "64px",
                    height: isMobile ? "52px" : "64px",
                    padding: "2px",
                    borderRadius: "8px",
                    border:
                      index === safeIndex ? "2px solid #ff6b00" : "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {brokenImages.includes(src) ? (
                    <div
                      aria-label="Image unavailable"
                      title="Image unavailable"
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#f0f0f0",
                        borderRadius: "6px",
                        fontSize: isMobile ? "16px" : "20px",
                      }}
                    >
                      🖼️
                    </div>
                  ) : (
                    <img
                      src={src}
                      alt={`${product.name} ${index + 1}`}
                      onError={() => handleImageError(index)}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        borderRadius: "6px",
                        display: "block",
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
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

          {/* RATING (only when genuine data exists) + TRUSTED SELLER
              (only when explicitly flagged) */}
          {(hasRating || trustedSeller) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                marginBottom: "12px",
              }}
            >
              {hasRating && (
                <>
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
                    ★ {ratingNum}
                  </span>
                  <span style={{ fontSize: "13px", color: "#777" }}>Rating</span>
                </>
              )}

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
          )}

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
              {/* customerPrice is a plain NUMBER from the backend —
                  give it the same ₹ presentation the string prices
                  already carry (display-only, value untouched). */}
              {typeof price === "number"
                ? `₹${price.toLocaleString("en-IN")}`
                : price}
            </span>

            {mrp && mrpNum > priceNum ? (
              <span
                style={{
                  color: "#888",
                  textDecoration: "line-through",
                  fontSize: "17px",
                }}
              >
                {/* Seller form captures MRP as a plain number — render
                    it exactly like the product card does (₹ prefix if
                    the value doesn't carry one). Display-only. */}
                {String(mrp).includes("₹") ? mrp : `₹${mrp}`}
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

          {/* FINAL-PRICE-ONLY UI (display-only): no fee / GST /
              seller-price details render here — the customer sees only
              MRP, final price and discount. Backend calculations and
              order records are untouched. */}

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

          {product.shortDetails &&
            product.description &&
            product.description !== product.shortDetails && (
              <p
                style={{
                  color: "#555",
                  lineHeight: "1.6",
                  marginTop: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {product.description}
              </p>
            )}

          {/* QUANTITY SELECTOR — feeds the existing cart / checkout */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginTop: "14px",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#333" }}>
              Quantity:
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                border: "1px solid #ddd",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => clampQuantity(q - 1))}
                disabled={quantity <= 1}
                style={{
                  width: "38px",
                  height: "38px",
                  border: "none",
                  background: "#f5f5f5",
                  fontSize: "18px",
                  fontWeight: "bold",
                  cursor: quantity <= 1 ? "not-allowed" : "pointer",
                  color: "#333",
                }}
              >
                −
              </button>
              <span
                style={{
                  minWidth: "42px",
                  textAlign: "center",
                  fontSize: "16px",
                  fontWeight: 700,
                }}
              >
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => clampQuantity(q + 1, maxQuantity))}
                disabled={quantity >= maxQuantity}
                style={{
                  width: "38px",
                  height: "38px",
                  border: "none",
                  background: "#f5f5f5",
                  fontSize: "18px",
                  fontWeight: "bold",
                  cursor: quantity >= maxQuantity ? "not-allowed" : "pointer",
                  color: "#333",
                }}
              >
                +
              </button>
            </div>
            <span style={{ fontSize: "12px", color: "#999" }}>
              (max {maxQuantity})
            </span>
          </div>

          {/* ACTION BUTTONS */}
          <div
            style={{
              marginTop: "auto",
              paddingTop: isMobile ? "8px" : "16px",
            }}
          >
            {/* OUT OF STOCK — tracked stock hit 0: both purchase
                actions are blocked here AND re-checked atomically on
                the server when the order is placed. */}
            {outOfStock && (
              <div
                role="status"
                aria-label="Out of stock"
                style={{
                  background: "#fdecea",
                  border: "1px solid #f5c6c2",
                  color: "#a02020",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: 700,
                  marginBottom: "12px",
                  textAlign: "center",
                }}
              >
                ❌ Out of Stock — this product cannot be ordered right now.
              </div>
            )}

            {/* ADD TO CART — same App-level cart, selected quantity */}
            <button
              type="button"
              disabled={outOfStock}
              aria-label={outOfStock ? "Out of stock — cannot add to cart" : "Add to cart"}
              onClick={() => addToCart && addToCart(product, quantity)}
              style={{
                width: "100%",
                background: outOfStock ? "#e4e4e7" : "#ff6b00",
                color: outOfStock ? "#8a8a92" : "white",
                border: "none",
                padding: "15px",
                borderRadius: "10px",
                cursor: outOfStock ? "not-allowed" : "pointer",
                fontSize: "17px",
                fontWeight: "bold",
              }}
            >
              {outOfStock ? "Sold Out" : "🛒 Add to Cart"}
            </button>

            {/* BUY NOW — direct checkout of THIS product + quantity.
                Never adds the product to the cart. */}
            <button
              type="button"
              disabled={outOfStock}
              aria-label={outOfStock ? "Out of stock — cannot buy" : "Buy now"}
              onClick={() => onBuyNow && onBuyNow(product, quantity)}
              style={{
                width: "100%",
                background: outOfStock ? "#e4e4e7" : "#ff9f00",
                color: outOfStock ? "#8a8a92" : "white",
                border: "none",
                padding: "15px",
                borderRadius: "10px",
                cursor: outOfStock ? "not-allowed" : "pointer",
                fontSize: "17px",
                fontWeight: "bold",
                marginTop: "12px",
              }}
            >
              {outOfStock ? "Unavailable" : "⚡ Buy Now"}
            </button>

            {/* WISHLIST — same App-level wishlist state */}
            {addToWishlist && (
              <button
                type="button"
                aria-label={wished ? "Already in wishlist" : "Add to wishlist"}
                onClick={() => addToWishlist(product)}
                style={{
                  width: "100%",
                  background: wished ? "#fff0f7" : "white",
                  color: "#ff1493",
                  border: "2px solid #ff1493",
                  padding: "13px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                  marginTop: "12px",
                }}
              >
                {wished ? "♥ In Wishlist" : "♡ Wishlist"}
              </button>
            )}

            {/* PROTECTED CHAT — product-scoped buyer ↔ seller chat */}
            {onChat ? (
              <button
                type="button"
                onClick={() => onChat(product)}
                style={{
                  width: "100%",
                  background: "white",
                  color: "#ff6b00",
                  border: "2px solid #ff6b00",
                  padding: "13px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                  marginTop: "12px",
                }}
              >
                💬 Chat with Seller
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* CUSTOMER REVIEWS — full width below the two-column layout */}
      <ProductReviews product={product} />

      {/* ZOOM / ENLARGED VIEW — contain fit, never cropped */}
      {zoomOpen && mainImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged product image"
          onClick={() => setZoomOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.82)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <button
            type="button"
            aria-label="Close zoom"
            onClick={() => setZoomOpen(false)}
            style={{
              position: "absolute",
              top: "14px",
              right: "14px",
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.92)",
              color: "#222",
              fontSize: "19px",
              fontWeight: "bold",
              cursor: "pointer",
              zIndex: 201,
            }}
          >
            ✕
          </button>

          {hasMultipleImages && (
            <>
              <button
                type="button"
                aria-label="Previous image (zoom)"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPrev();
                }}
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(255,255,255,0.92)",
                  color: "#222",
                  fontSize: "20px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  zIndex: 201,
                }}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next image (zoom)"
                onClick={(e) => {
                  e.stopPropagation();
                  goToNext();
                }}
                style={{
                  position: "absolute",
                  right: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(255,255,255,0.92)",
                  color: "#222",
                  fontSize: "20px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  zIndex: 201,
                }}
              >
                ›
              </button>
            </>
          )}

          {/* stopPropagation keeps clicks on the image from closing */}
          <img
            src={mainImage}
            alt={`${product.name} (enlarged)`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "94vw",
              maxHeight: "88vh",
              objectFit: "contain",
              borderRadius: "10px",
              background: "#fff",
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// =====================================================
// CUSTOMER REVIEWS — frontend-safe subset only
// =====================================================
// The JustBrand backend has NO review endpoint or table (verified in
// backend/server.js and backend/business.js — zero review routes),
// so this section never claims a server save. Reviews written here
// are stored per-product in THIS browser's localStorage and every
// entry is labelled "Saved on this device". Nothing is invented:
// the list starts empty and shows only what the user actually
// wrote. Publishing reviews to the store requires a backend review
// API (GET/POST /api/products/:id/reviews) — deliberately not
// built here because production backend changes are out of scope.

const REVIEW_STORAGE_KEY = "jb_local_reviews_v1";

function readLocalReviews(productId) {
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return Array.isArray(all[productId]) ? all[productId] : [];
  } catch {
    return [];
  }
}

function writeLocalReviews(productId, reviews) {
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[productId] = reviews;
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

function ProductReviews({ product }) {
  const productId = String(product?.id ?? "");
  const [reviews, setReviews] = useState(() =>
    readLocalReviews(productId)
  );
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState(null);

  // Product switch (URL navigation) resets the form and reloads
  // that product's device-local reviews.
  useEffect(() => {
    setReviews(readLocalReviews(productId));
    setRating(0);
    setHoverRating(0);
    setText("");
    setFeedback(null);
  }, [productId]);

  function handleSubmit(event) {
    event.preventDefault();

    if (rating < 1) {
      setFeedback({
        tone: "error",
        message: "Please select a star rating (1–5).",
      });
      return;
    }

    const trimmed = text.trim();

    if (!trimmed) {
      setFeedback({
        tone: "error",
        message: "Please write a few words about the product.",
      });
      return;
    }

    const entry = {
      rating,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    const next = [entry, ...reviews].slice(0, 50);

    if (!writeLocalReviews(productId, next)) {
      setFeedback({
        tone: "error",
        message:
          "Could not save on this device — browser storage is unavailable.",
      });
      return;
    }

    setReviews(next);
    setRating(0);
    setText("");
    setFeedback({
      tone: "success",
      message:
        "Thanks! Your review is saved on this device. It will reach the store once JustBrand's review API goes live.",
    });
  }

  const displayStars = hoverRating || rating;

  return (
    <section
      aria-label="Customer reviews"
      style={{
        marginTop: "26px",
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: "14px",
        padding: "20px 18px",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: "19px", color: "#222" }}>
        Customer Reviews
      </h2>

      <p
        style={{ margin: "0 0 16px", color: "#777", fontSize: "13px" }}
      >
        {reviews.length > 0
          ? `${reviews.length} review${
              reviews.length === 1 ? "" : "s"
            } saved on this device`
          : "No reviews yet for this product."}
      </p>

      {/* SAVED (DEVICE-LOCAL) REVIEWS */}
      <ul
        style={{
          listStyle: "none",
          margin: "0 0 18px",
          padding: "0",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {reviews.map((review, index) => (
          <li
            key={`${review.createdAt}-${index}`}
            style={{
              border: "1px solid #f0f0f3",
              borderRadius: "10px",
              padding: "12px 14px",
              background: "#fafafc",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                marginBottom: "4px",
              }}
            >
              <span
                aria-label={`Rated ${review.rating} out of 5`}
                style={{
                  color: "#f5a623",
                  fontSize: "15px",
                  letterSpacing: "2px",
                }}
              >
                {"★".repeat(review.rating)}
                <span style={{ color: "#ddd", letterSpacing: "0" }}>
                  {"★".repeat(5 - review.rating)}
                </span>
              </span>

              <span
                style={{
                  fontSize: "11px",
                  color: "#6b6b74",
                  background: "#fff0f6",
                  border: "1px solid #ffd6e8",
                  borderRadius: "20px",
                  padding: "2px 8px",
                }}
              >
                Saved on this device
              </span>
            </div>

            <p
              style={{
                margin: "0",
                color: "#333",
                fontSize: "14px",
                lineHeight: "1.55",
                whiteSpace: "pre-wrap",
              }}
            >
              {review.text}
            </p>
          </li>
        ))}
      </ul>

      {/* WRITE A REVIEW */}
      <form
        onSubmit={handleSubmit}
        style={{
          borderTop: "1px solid #f0f0f3",
          paddingTop: "16px",
        }}
      >
        <label
          style={{
            display: "block",
            fontWeight: "700",
            fontSize: "14px",
            color: "#222",
            marginBottom: "8px",
          }}
        >
          Write a review
        </label>

        <div
          role="group"
          aria-label="Star rating"
          style={{
            display: "flex",
            gap: "4px",
            marginBottom: "10px",
          }}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => {
                setRating(value);
                setFeedback(null);
              }}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "28px",
                lineHeight: "1",
                padding: "2px",
                color:
                  value <= displayStars ? "#f5a623" : "#d8d8de",
              }}
            >
              ★
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFeedback(null);
          }}
          maxLength={500}
          rows={3}
          placeholder="Share your experience with this product…"
          aria-label="Review text"
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1.5px solid #d8deec",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "14px",
            fontFamily: "inherit",
            resize: "vertical",
            minHeight: "74px",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginTop: "10px",
          }}
        >
          <button
            type="submit"
            style={{
              background: "linear-gradient(90deg,#ff6b00,#ff1493)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "11px 22px",
              fontWeight: "700",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Submit Review
          </button>

          <span style={{ fontSize: "11.5px", color: "#8b8b94" }}>
            Reviews stay on this device until JustBrand's review API
            is available.
          </span>
        </div>

        {feedback && (
          <p
            role={feedback.tone === "error" ? "alert" : "status"}
            style={{
              margin: "10px 0 0",
              fontSize: "13px",
              fontWeight: "600",
              color:
                feedback.tone === "error" ? "#b91c1c" : "#128807",
            }}
          >
            {feedback.tone === "error" ? "⚠ " : "✓ "}
            {feedback.message}
          </p>
        )}
      </form>
    </section>
  );
}

export default ProductDetails;

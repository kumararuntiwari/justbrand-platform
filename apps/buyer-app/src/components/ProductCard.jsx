import { useState } from "react";

function ProductCard({
  product,
  addToCart,
  onSelect,
  onCompare,
  addToWishlist,
  isWishlisted,
}) {
  const fallbackImages = [
    "/images/product1.png",
    "/images/product2.jpeg",
    "/images/product3.jpeg",
    "/images/product4.jpg",
  ];

  const normalizeImage = (value, fallback) => {
    if (!value) return fallback;

    let image = String(value);

    if (!image.startsWith("data:image/")) {
      if (image.includes("\\")) {
        image = image.split("\\").pop();
      }

      image = image.replace(
        /^.*[\\/]public[\\/]images[\\/]/i,
        ""
      );
      image = image.replace(/^\/?images[\\/]/i, "");

      if (!/^https?:\/\//i.test(image) && !image.startsWith("/")) {
        image = "/images/" + image;
      }
    }

    return image || fallback;
  };

  const rawImages = Array.isArray(product?.images)
    ? product.images
    : [
        product?.image,
        product?.image2,
        product?.image3,
        product?.image4,
      ];

  // IMAGE FALLBACK CHAIN: try the product's own images in order
  // (deduped so a dead URL is never retried in a loop); only when
  // every own image failed do we swap to the generic local
  // placeholder — never silently on the first broken URL.
  const ownImages = [
    ...new Set(
      rawImages
        .filter(Boolean)
        .slice(0, 4)
        .map((image, index) =>
          normalizeImage(image, fallbackImages[index])
        )
    ),
  ];

  const imagePool = ownImages.length
    ? ownImages
    : [fallbackImages[0]];

  const [imageIndex, setImageIndex] = useState(0);
  const [useGenericFallback, setUseGenericFallback] =
    useState(false);

  const safeImageIndex = Math.min(
    imageIndex,
    imagePool.length - 1
  );

  const cardImageSrc = useGenericFallback
    ? fallbackImages[0]
    : imagePool[safeImageIndex];

  const handleImageError = () => {
    // Last-resort image failed too — stop, never loop.
    if (useGenericFallback) return;

    if (safeImageIndex < imagePool.length - 1) {
      setImageIndex(safeImageIndex + 1);
    } else {
      setUseGenericFallback(true);
    }
  };

  const productName = product?.name || "Product";
  // LIMITED STOCK TRACKING: only the backend's explicit
  // `inStock === false` marks a product unavailable — products
  // without stock data (untracked/unlimited) stay fully buyable.
  const outOfStock = product?.inStock === false;
  const sellerPrice = product?.price !== undefined ? product.price : 0;
  const price = product?.customerPrice !== undefined && product?.customerPrice !== null && product?.customerPrice !== ""
    ? product.customerPrice
    : sellerPrice;
  // MRP comes from the backend's comparePrice column (fall back to
  // any mrp field for older data). Used for the strike-through and
  // the real discount percentage — no invented numbers.
  const mrp =
    product?.mrp !== undefined && product?.mrp !== null
      ? product.mrp
      : product?.comparePrice;
  const priceNum = Number(String(price).replace(/[^0-9.]/g, "")) || 0;
  const mrpNum = Number(String(mrp).replace(/[^0-9.]/g, "")) || 0;
  // REAL DATA ONLY: show a rating chip only when the backend
  // actually provides a numeric rating — never a default/fake value.
  const ratingNum = Number(product?.rating);
  const hasRating = Number.isFinite(ratingNum) && ratingNum > 0;
  const discount =
    product?.discount !== undefined
      ? product.discount
      : mrpNum > priceNum && mrpNum > 0
      ? Math.round(((mrpNum - priceNum) / mrpNum) * 100)
      : 0;
  // Trusted-Seller badge only when the data explicitly says so.
  const trustedSeller = product?.trustedSeller === true;

  const formatPrice = (value) => {
    if (value === undefined || value === null || value === "") return "₹0";
    const text = String(value);
    return text.includes("₹") ? text : `₹${text}`;
  };

  // FINAL-PRICE-ONLY UI (display-only): cards render exactly MRP,
  // final price and discount — no fee, GST, seller-price or charge
  // details ever show. All backend calculations stay as-is.

  const openDetails = () => {
    if (onSelect) onSelect(product);
  };

  return (
    <div
      className="jb-pcard"
      role="button"
      tabIndex={0}
      aria-label={`View details of ${productName}`}
      style={{
        background: "#ffffff",
        borderRadius: "14px",
        padding: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.10)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        border: "1px solid #eeeeee",
      }}
      onClick={openDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetails();
        }
      }}
    >
      {/* PRODUCT IMAGE — clean marketplace-style box with a
          consistent aspect ratio; contain keeps the full product
          visible without distortion regardless of image dimensions */}
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#fafafa",
          borderRadius: "12px",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {discount > 0 && !outOfStock && (
          <span
            style={{
              position: "absolute",
              top: "8px",
              left: "8px",
              background: "linear-gradient(135deg, #ff6b00, #ff1493)",
              color: "white",
              padding: "5px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: "bold",
              zIndex: 3,
            }}
          >
            {discount}% OFF
          </span>
        )}

        {outOfStock && (
          <span
            aria-label="Out of stock"
            style={{
              position: "absolute",
              top: "8px",
              left: "8px",
              background: "rgba(30,30,30,0.82)",
              color: "white",
              padding: "5px 9px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: "bold",
              zIndex: 3,
            }}
          >
            ❌ Out of Stock
          </span>
        )}

        {addToWishlist && (
          <button
            type="button"
            aria-label={
              isWishlisted
                ? "Already in wishlist"
                : "Add to wishlist"
            }
            aria-pressed={Boolean(isWishlisted)}
            onClick={(e) => {
              e.stopPropagation();
              addToWishlist(product);
            }}
            style={{
              position: "absolute",
              top: "7px",
              right: "7px",
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              border: "1px solid #eeeeee",
              background: isWishlisted ? "#ffe4f0" : "white",
              color: "#ff1493",
              fontSize: "18px",
              lineHeight: "1",
              cursor: "pointer",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
            }}
          >
            {isWishlisted ? "♥" : "♡"}
          </button>
        )}

        <img
          src={cardImageSrc}
          alt={productName}
          onError={handleImageError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: "10px",
            boxSizing: "border-box",
            display: "block",
          }}
        />
      </div>

      {/* PRODUCT DETAILS */}
      <div
        style={{
          paddingTop: "10px",
          display: "flex",
          flexDirection: "column",
          flex: 1,
        }}
      >
        <h3
          style={{
            margin: "0 0 7px",
            fontSize: "16px",
            lineHeight: "1.35",
            fontWeight: "600",
            color: "#222",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "43px",
          }}
        >
          {productName}
        </h3>

        {hasRating && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              marginBottom: "7px",
            }}
          >
            <span
              aria-label={`Rated ${ratingNum} out of 5`}
              style={{
                background: "#f5a623",
                color: "white",
                padding: "3px 7px",
                borderRadius: "5px",
                fontSize: "12px",
                fontWeight: "bold",
              }}
            >
              ★ {ratingNum}
            </span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            flexWrap: "wrap",
            margin: "0 0 4px",
          }}
        >
          <span style={{ fontSize: "21px", fontWeight: "700", color: "#111" }}>
            {formatPrice(price)}
          </span>

          {mrpNum > priceNum && (
            <span style={{ fontSize: "13px", color: "#888", textDecoration: "line-through" }}>
              {formatPrice(mrp)}
            </span>
          )}

          {discount > 0 && (
            <span style={{ fontSize: "13px", color: "#128807", fontWeight: "700" }}>
              {discount}% off
            </span>
          )}
        </div>

        {trustedSeller && (
          <p style={{ margin: "0 0 10px", color: "#168a3a", fontSize: "13px", fontWeight: "600" }}>
            ✓ Trusted Seller
          </p>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openDetails();
          }}
          style={{
            width: "100%",
            minHeight: "40px",
            marginBottom: "7px",
            background: "white",
            color: outOfStock ? "#999" : "#ff6b00",
            border: `1px solid ${outOfStock ? "#ddd" : "#ff6b00"}`,
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "700",
            fontSize: "13px",
          }}
        >
          {outOfStock ? "Unavailable" : "Checkout"}
        </button>

        <div style={{ display: "flex", gap: "7px", marginTop: "auto" }}>
          {onCompare && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCompare(product);
              }}
              style={{
                flex: 1,
                minHeight: "42px",
                padding: "8px 5px",
                background: "white",
                color: "#444",
                border: "1px solid #d9d9e0",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "700",
                fontSize: "13px",
              }}
            >
              ⚖️ Compare
            </button>
          )}

          {addToCart && (
            <button
              type="button"
              disabled={outOfStock}
              aria-label={outOfStock ? "Out of stock — cannot add to cart" : "Add to cart"}
              onClick={(e) => {
                e.stopPropagation();
                if (outOfStock) return;
                addToCart(product);
              }}
              style={{
                flex: 1,
                minHeight: "42px",
                padding: "8px 5px",
                background: outOfStock
                  ? "#e4e4e7"
                  : "linear-gradient(135deg, #ff8a00, #ff1493)",
                color: outOfStock ? "#8a8a92" : "white",
                border: "none",
                borderRadius: "8px",
                cursor: outOfStock ? "not-allowed" : "pointer",
                fontWeight: "700",
                fontSize: "13px",
              }}
            >
              {outOfStock ? "Sold Out" : "🛒 Add Cart"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
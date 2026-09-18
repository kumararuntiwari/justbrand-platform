function ProductCard({
  product,
  addToCart,
  onSelect,
  onCompare,
  addToWishlist,
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

  const productImages = rawImages
    .filter(Boolean)
    .slice(0, 4)
    .map((image, index) =>
      normalizeImage(image, fallbackImages[index])
    );

  while (productImages.length < 4) {
    productImages.push(
      productImages[0] || fallbackImages[productImages.length]
    );
  }

  const productName = product?.name || "Product";
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
  const rating = product?.rating || 4.5;
  const discount =
    product?.discount !== undefined
      ? product.discount
      : mrpNum > priceNum && mrpNum > 0
      ? Math.round(((mrpNum - priceNum) / mrpNum) * 100)
      : 0;
  const trustedSeller = product?.trustedSeller !== false;

  const formatPrice = (value) => {
    if (value === undefined || value === null || value === "") return "₹0";
    const text = String(value);
    return text.includes("₹") ? text : `₹${text}`;
  };

  const openDetails = () => {
    if (onSelect) onSelect(product);
  };

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "14px",
        padding: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.10)",
        cursor: "pointer",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        border: "1px solid #eeeeee",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "0 7px 20px rgba(0,0,0,0.16)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.10)";
      }}
      onClick={openDetails}
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
        {discount > 0 && (
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

        {addToWishlist && (
          <button
            type="button"
            aria-label="Add to wishlist"
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
              background: "white",
              color: "#ff1493",
              fontSize: "18px",
              cursor: "pointer",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
            }}
          >
            ♡
          </button>
        )}

        <img
          src={productImages[0]}
          alt={productName}
          onError={(e) => {
            e.currentTarget.src = fallbackImages[0];
          }}
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            marginBottom: "7px",
          }}
        >
          <span
            style={{
              background: "#f5a623",
              color: "white",
              padding: "3px 7px",
              borderRadius: "5px",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            ★ {rating}
          </span>
          <span style={{ fontSize: "12px", color: "#777" }}>Rating</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "5px",
          }}
        >
          <span style={{ fontSize: "22px", fontWeight: "700", color: "#111" }}>
            {formatPrice(price)}
          </span>

          {mrpNum > priceNum && (
            <span style={{ fontSize: "13px", color: "#888", textDecoration: "line-through" }}>
              {formatPrice(mrp)}
            </span>
          )}
        </div>

        {discount > 0 && (
          <p style={{ margin: "3px 0 7px", color: "#d32f2f", fontSize: "13px", fontWeight: "600" }}>
            🔥 {discount}% off
          </p>
        )}

        {product?.customerPrice !== undefined && (
          <p style={{ margin: "0 0 7px", color: "#666", fontSize: "11px" }}>
            Final price includes delivery, platform charges, JustBrand Family commission & GST
          </p>
        )}

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
            color: "#ff6b00",
            border: "1px solid #ff6b00",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "700",
            fontSize: "13px",
          }}
        >
          👁️ View Details
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
                background: "#ff6b00",
                color: "white",
                border: "none",
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
              onClick={(e) => {
                e.stopPropagation();
                addToCart(product);
              }}
              style={{
                flex: 1,
                minHeight: "42px",
                padding: "8px 5px",
                background: "linear-gradient(135deg, #ff8a00, #ff1493)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "700",
                fontSize: "13px",
              }}
            >
              🛒 Add Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
function ProductCard({
  product,
  addToCart,
  onSelect,
  onCompare,
  addToWishlist,
}) {
  const image =
    product && product.image
      ? product.image
      : "/images/product1.png";

  const productName =
    product && product.name
      ? product.name
      : "Product";

  const price =
    product && product.price !== undefined
      ? product.price
      : 0;

  const rating = product?.rating;

  const discount = product?.discount;

  const trustedSeller =
    product?.trustedSeller === true;

  const formatPrice = (value) => {
    if (value === undefined || value === null || value === "") {
      return "Price unavailable";
    }

    const text = String(value);

    return text.includes("₹")
      ? text
      : `₹${text}`;
  };

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "14px",
        padding: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.10)",
        cursor: "pointer",
        transition:
          "transform 0.2s ease, box-shadow 0.2s ease",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        border: "1px solid #eeeeee",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform =
          "translateY(-4px)";
        e.currentTarget.style.boxShadow =
          "0 7px 20px rgba(0,0,0,0.16)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform =
          "translateY(0)";
        e.currentTarget.style.boxShadow =
          "0 2px 10px rgba(0,0,0,0.10)";
      }}
      onClick={() => {
        if (onSelect) {
          onSelect(product);
        }
      }}
    >
      {/* PRODUCT IMAGE */}
      <div
        style={{
          height: "210px",
          background:
            "linear-gradient(135deg, #fafafa, #f2f2f2)",
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Discount Badge */}
        {discount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "9px",
              left: "9px",
              background:
                "linear-gradient(135deg, #ff6b00, #ff1493)",
              color: "white",
              padding: "5px 9px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: "bold",
              zIndex: 2,
            }}
          >
            {discount}% OFF
          </span>
        )}

        {/* Wishlist */}
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
              top: "8px",
              right: "8px",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              border: "1px solid #eeeeee",
              background: "white",
              color: "#ff1493",
              fontSize: "18px",
              cursor: "pointer",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                "0 2px 6px rgba(0,0,0,0.10)",
            }}
          >
            ♡
          </button>
        )}

        <img
          src={image}
          alt={productName}
          onError={(e) => {
            e.currentTarget.src =
              "/images/product1.png";
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: "8px",
            boxSizing: "border-box",
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
        {/* PRODUCT NAME */}
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

        {/* RATING */}
        {rating !== undefined &&
          rating !== null &&
          rating !== "" && (
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

              <span
                style={{
                  fontSize: "12px",
                  color: "#777",
                }}
              >
                Rating
              </span>
            </div>
          )}

        {/* PRICE */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "5px",
          }}
        >
          <span
            style={{
              fontSize: "22px",
              fontWeight: "700",
              color: "#111",
            }}
          >
            {formatPrice(price)}
          </span>

          {product?.comparePrice &&
            Number(product.comparePrice) >
              Number(
                String(price).replace("₹", "")
              ) && (
              <span
                style={{
                  fontSize: "1        {/* DISCOUNT */}
        {Number(discount) > 0 && (
          <p
            style={{
              margin: "3px 0 7px",
              color: "#d32f2f",
              fontSize: "13px",
              fontWeight: "600",
            }}
          >
            Discount: {discount}%
          </p>
        )}

tyle={{
              margin: "3px 0 7px",
              color: "#d32f2f",
              fontSize: "13px",
              fontWeight: "600",
            }}
          >
            🔥 Great Deal
          </p>
        )}

        {/* TRUSTED SELLER */}
        {trustedSeller && (
          <p
            style={{
              margin: "0 0 10px",
              color: "#168a3a",
              fontSize: "13px",
              fontWeight: "600",
            }}
          >
            ✓ Trusted Seller
          </p>
        )}

        {/* BUTTONS */}
        <div
          style={{
            display: "flex",
            gap: "7px",
            marginTop: "auto",
          }}
        >
          {/* COMPARE */}
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

          {/* ADD CART */}
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
                background:
                  "linear-gradient(135deg, #ff8a00, #ff1493)",
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
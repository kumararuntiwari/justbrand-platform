function ProductCard({
  product,
  addToCart,
  onSelect,
  onCompare,
  addToWishlist,
}) {
  // =========================
  // PRODUCT IMAGE
  // =========================

  const getImageUrl = () => {
    if (!product?.image) {
      return "/images/product1.png";
    }

    if (
      product.image.startsWith("http://") ||
      product.image.startsWith("https://")
    ) {
      return product.image;
    }

    if (product.image.startsWith("/images/")) {
      return product.image;
    }

    const fileName = product.image
      .split("/")
      .pop();

    return `/images/${fileName}`;
  };

  const imageUrl = getImageUrl();

  // =========================
  // CARD
  // =========================

  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        padding: "12px",
        boxShadow: "0 2px 8px #ddd",
        minWidth: "220px",
        cursor: "pointer",
      }}
      onClick={() => onSelect(product)}
    >
      {/* PRODUCT IMAGE */}

      <div
        style={{
          height: "190px",
          background: "#eee",
          borderRadius: "10px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={imageUrl}
          alt={product.name || "Product"}
          onError={(e) => {
            e.currentTarget.src =
              "/images/product1.png";
          }}
          style={{
            width: "100%",
            height: "190px",
            objectFit: "contain",
            borderRadius: "10px",
          }}
        />
      </div>

      {/* PRODUCT NAME */}

      <h3
        style={{
          margin: "10px 0 5px",
          fontSize: "17px",
        }}
      >
        {product.name || "Product"}
      </h3>

      {/* RATING */}

      <p
        style={{
          margin: "5px 0",
        }}
      >
        ⭐ 4.5 Rating
      </p>

      {/* PRICE */}

      <h2
        style={{
          margin: "8px 0",
        }}
      >
        {product.price || "₹0"}
      </h2>

      {/* OFFER */}

      <p
        style={{
          color: "red",
          fontWeight: "bold",
          margin: "5px 0",
        }}
      >
        🔥 20% OFF
      </p>

      {/* TRUSTED SELLER */}

      <p
        style={{
          color: "green",
          margin: "5px 0 12px",
        }}
      >
        ✓ Trusted Seller
      </p>

      {/* BUTTONS */}

      <div
        style={{
          display: "flex",
          gap: "8px",
        }}
      >
        {/* COMPARE BUTTON */}

        <button
          onClick={(e) => {
            e.stopPropagation();

            if (onCompare) {
              onCompare(product);
            }
          }}
          style={{
            flex: 1,
            padding: "10px 5px",
            background: "#ff6b00",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: "bold",
          }}
        >
          ⚖️ Compare
        </button>

        {/* CART BUTTON */}

        <button
          onClick={(e) => {
            e.stopPropagation();

            if (addToCart) {
              addToCart(product);
            }
          }}
          style={{
            flex: 1,
            padding: "10px 5px",
            background: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: "bold",
          }}
        >
          🛒 Add Cart
        </button>
      </div>

      {/* WISHLIST */}

      {addToWishlist && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            addToWishlist(product);
          }}
          style={{
            width: "100%",
            marginTop: "8px",
            padding: "9px",
            background: "white",
            color: "#ff1493",
            border: "1px solid #ff1493",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ❤️ Add to Wishlist
        </button>
      )}
    </div>
  );
}

export default ProductCard;
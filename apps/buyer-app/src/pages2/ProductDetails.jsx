function ProductDetails({ product, addToCart, onBack }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        padding: "20px",
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
      <div
        style={{
          maxWidth: "1000px",
          margin: "auto",
          background: "white",
          borderRadius: "15px",
          padding: "25px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "30px",
          boxShadow: "0 2px 10px #ddd",
        }}
      >
        {/* PRODUCT IMAGE */}
        <div
          style={{
            height: "400px",
            background: "#f8f8f8",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={product.image}
            alt={product.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              borderRadius: "12px",
            }}
          />
        </div>

        {/* PRODUCT INFORMATION */}
        <div>
          <p
            style={{
              color: "#777",
              marginBottom: "8px",
            }}
          >
            {product.category}
          </p>

          <h1
            style={{
              fontSize: "30px",
              marginTop: "0",
              marginBottom: "15px",
            }}
          >
            {product.name}
          </h1>

          {/* PRICE */}
          <div style={{ marginBottom: "20px" }}>
            <span
              style={{
                fontSize: "30px",
                fontWeight: "bold",
                color: "#ff6b00",
              }}
            >
              {product.price}
            </span>

            <span
              style={{
                marginLeft: "15px",
                color: "#888",
                textDecoration: "line-through",
                fontSize: "18px",
              }}
            >
              {product.oldPrice}
            </span>
          </div>

          {/* OFFER */}
          <div
            style={{
              background: "#fff3e8",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "20px",
              color: "#e85d00",
              fontWeight: "bold",
            }}
          >
            🔥 Special Offer Available
          </div>

          {/* DESCRIPTION */}
          <p
            style={{
              color: "#555",
              lineHeight: "1.6",
            }}
          >
            High quality product available on JustBrand.
            Shop easily and get the best price.
          </p>

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
              fontSize: "18px",
              fontWeight: "bold",
              marginTop: "20px",
            }}
          >
            🛒 Add to Cart
          </button>

          {/* BUY NOW */}
          <button
            style={{
              width: "100%",
              background: "#ff9f00",
              color: "white",
              border: "none",
              padding: "15px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "18px",
              fontWeight: "bold",
              marginTop: "12px",
            }}
          >
            ⚡ Buy Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductDetails;
function ProductDetails({ product, onBack, addToCart }) {
  if (!product) return null;

  return (
    <div
      style={{
        maxWidth: "1100px",
        margin: "40px auto",
        padding: "20px",
        display: "flex",
        gap: "30px",
        alignItems: "flex-start",
        background: "#fff",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
      }}
    >
      <div style={{ flex: 1 }}>
        <img
          src={product.image}
          alt={product.name}
          style={{
            width: "100%",
            maxWidth: "400px",
            borderRadius: "10px",
          }}
        />
      </div>

      <div style={{ flex: 1 }}>
        <button
          onClick={onBack}
          style={{
            marginBottom: "20px",
            padding: "10px 18px",
            background: "#ddd",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <h2>{product.name}</h2>

        <h1 style={{ color: "#ff6b00" }}>{product.price}</h1>

        <p>⭐⭐⭐⭐⭐ (4.8 Rating)</p>

        <p>
          Premium quality product with best price, trusted seller and fast
          delivery.
        </p>

        <button
          onClick={() => addToCart(product)}
          style={{
            padding: "12px 25px",
            background: "#28a745",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            marginRight: "10px",
          }}
        >
          🛒 Add to Cart
        </button>

        <button
          style={{
            padding: "12px 25px",
            background: "#ff6b00",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Buy Now
        </button>
      </div>
    </div>
  );
}

export default ProductDetails;
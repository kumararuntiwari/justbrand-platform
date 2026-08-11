import { useEffect, useState } from "react";

function CompareSlider({ products, onSelect, onCompare }) {
  const [start, setStart] = useState(0);

  // हर 3 सेकंड में अगला group
  useEffect(() => {
    if (products.length <= 4) return;

    const timer = setInterval(() => {
      setStart((prev) => (prev + 1) % products.length);
    }, 3000);

    return () => clearInterval(timer);
  }, [products.length]);

  const visibleProducts = [];

  for (let i = 0; i < Math.min(4, products.length); i++) {
    visibleProducts.push(products[(start + i) % products.length]);
  }

  return (
    <div
      style={{
        padding: "15px 20px",
        background: "#fff",
        margin: "10px 20px",
        borderRadius: "10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        overflow: "hidden",
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        Compare Price
      </h2>

      <div
        style={{
          display: "grid",
         gridTemplateColumns:
  "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "12px",
        }}
      >
        {visibleProducts.map((product, index) => (
          <div
            key={`${product.name}-${index}`}
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "10px",
              background: "#fff",
              cursor: "pointer",
            }}
            onClick={() => onSelect(product)}
          >
            <img
              src={product.image}
              alt={product.name}
              style={{
                width: "100%",
                height: "150px",
                objectFit: "contain",
                display: "block",
              }}
            />

            <div
              style={{
                fontWeight: "bold",
                marginTop: "8px",
              }}
            >
              {product.name}
            </div>

            <div
              style={{
                color: "#e53935",
                fontWeight: "bold",
                marginTop: "5px",
              }}
            >
              {product.price}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onCompare(product);
              }}
              style={{
                marginTop: "8px",
                width: "100%",
                padding: "8px",
                background: "#ff9800",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Compare Price
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CompareSlider;
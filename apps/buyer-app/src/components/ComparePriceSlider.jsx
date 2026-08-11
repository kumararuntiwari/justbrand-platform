import React from "react";

function ComparePriceSlider({
  products = [],
  onCompare,
}) {
  // Image path
  const getImageUrl = (image) => {
    if (!image) {
      return "/images/product1.png";
    }

    if (
      image.startsWith("http://") ||
      image.startsWith("https://")
    ) {
      return image;
    }

    if (image.startsWith("/images/")) {
      return image;
    }

    const fileName = image
      .split("/")
      .pop();

    return `/images/${fileName}`;
  };

  // No products
  if (products.length === 0) {
    return null;
  }

  return (
    <section
      style={{
        background: "white",
        padding: "20px",
        marginTop: "20px",
      }}
    >
      {/* =================================
          TITLE
      ================================= */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              color: "#222",
            }}
          >
            ⚖️ Compare Price
          </h2>

          <p
            style={{
              margin: "5px 0 0",
              color: "#666",
            }}
          >
            Compare prices before you buy
          </p>
        </div>
      </div>

      {/* =================================
          SLIDER
      ================================= */}

      <div
        style={{
          display: "flex",
          gap: "18px",
          overflowX: "auto",
          paddingBottom: "10px",
          scrollBehavior: "smooth",
        }}
      >
        {products.map((product) => (
          <div
            key={product.id}
            style={{
              minWidth: "230px",
              maxWidth: "230px",
              background: "#fff",
              borderRadius: "12px",
              padding: "12px",
              boxShadow:
                "0 2px 8px rgba(0,0,0,0.12)",
              border:
                "1px solid #eee",
              flexShrink: 0,
            }}
          >
            {/* PRODUCT IMAGE */}

            <div
              style={{
                height: "170px",
                background: "#f5f5f5",
                borderRadius: "10px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              <img
                src={getImageUrl(
                  product.image
                )}
                alt={product.name}
                onError={(e) => {
                  e.currentTarget.src =
                    "/images/product1.png";
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
            </div>

            {/* PRODUCT NAME */}

            <h3
              style={{
                fontSize: "16px",
                margin:
                  "10px 0 5px",
                whiteSpace:
                  "nowrap",
                overflow: "hidden",
                textOverflow:
                  "ellipsis",
              }}
            >
              {product.name}
            </h3>

            {/* JUSTBRAND PRICE */}

            <h3
              style={{
                color: "#ff6b00",
                margin: "5px 0",
              }}
            >
              {product.price}
            </h3>

            {/* COMPARE BUTTON */}

            <button
              onClick={() =>
                onCompare(product)
              }
              style={{
                width: "100%",
                padding: "11px",
                marginTop: "8px",
                background:
                  "#ff1493",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ⚖️ Compare Price
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ComparePriceSlider;
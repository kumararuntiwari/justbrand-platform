import React, { useState } from "react";

function ComparePrice({ products = [], onBack }) {
  const [current, setCurrent] = useState(0);
  const [search, setSearch] = useState("");

  // =====================================
  // IMAGE PATH
  // =====================================

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

  // =====================================
  // PRODUCTS
  // =====================================

  const visibleProducts = products.filter(
    (product) =>
      String(product.name || "")
        .toLowerCase()
        .includes(
          search.toLowerCase()
        )
  );

  const product =
    visibleProducts.length > 0
      ? visibleProducts[current] ||
        visibleProducts[0]
      : null;

  // =====================================
  // NEXT
  // =====================================

  const nextProduct = () => {
    if (visibleProducts.length === 0) {
      return;
    }

    setCurrent((prev) =>
      prev >= visibleProducts.length - 1
        ? 0
        : prev + 1
    );
  };

  // =====================================
  // PREVIOUS
  // =====================================

  const previousProduct = () => {
    if (visibleProducts.length === 0) {
      return;
    }

    setCurrent((prev) =>
      prev <= 0
        ? visibleProducts.length - 1
        : prev - 1
    );
  };

  // =====================================
  // SEARCH
  // =====================================

  const handleSearch = (e) => {
    setSearch(e.target.value);
    setCurrent(0);
  };

  // =====================================
  // BUY
  // =====================================

  const buyNow = (site) => {
    alert(
      `${site} link will be connected with authorized API / affiliate integration at final stage.`
    );
  };

  // =====================================
  // NO PRODUCT
  // =====================================

  if (!product) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f5f5",
          padding: "20px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "#333",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <div
          style={{
            maxWidth: "600px",
            margin: "50px auto",
            background: "white",
            padding: "40px",
            borderRadius: "15px",
            textAlign: "center",
            boxShadow: "0 2px 10px #ddd",
          }}
        >
          <h2>
            ⚖️ Compare Price
          </h2>

          <p>
            No product available for comparison.
          </p>
        </div>
      </div>
    );
  }

  // =====================================
  // PRICE
  // =====================================

  const justBrandPrice =
    Number(
      String(product.price || "0")
        .replace("₹", "")
        .replace(",", "")
    ) || 0;

  const amazonPrice =
    justBrandPrice > 0
      ? justBrandPrice - 50
      : 949;

  const flipkartPrice =
    justBrandPrice > 0
      ? justBrandPrice - 30
      : 969;

  const meeshoPrice =
    justBrandPrice > 0
      ? justBrandPrice - 80
      : 919;

  const prices = [
    justBrandPrice,
    amazonPrice,
    flipkartPrice,
    meeshoPrice,
  ].filter((price) => price > 0);

  const bestPrice =
    Math.min(...prices);

  // =====================================
  // PAGE
  // =====================================

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        padding: "20px",
      }}
    >
      {/* =================================
          TOP BAR
      ================================= */}

      <div
        style={{
          maxWidth: "1000px",
          margin: "auto",
          display: "flex",
          alignItems: "center",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "#333",
            color: "white",
            border: "none",
            padding: "10px 18px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <h2
          style={{
            margin: 0,
          }}
        >
          ⚖️ Compare Price
        </h2>
      </div>

      {/* =================================
          SEARCH
      ================================= */}

      <div
        style={{
          maxWidth: "700px",
          margin: "0 auto 25px",
        }}
      >
        <input
          type="text"
          placeholder="🔎 Search product..."
          value={search}
          onChange={handleSearch}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "14px",
            borderRadius: "10px",
            border: "1px solid #ccc",
            fontSize: "16px",
            outline: "none",
          }}
        />
      </div>

      {/* =================================
          MAIN PRODUCT SLIDER
      ================================= */}

      <div
        style={{
          maxWidth: "550px",
          margin: "auto",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "15px",
            boxShadow: "0 2px 10px #ddd",
          }}
        >
          {/* IMAGE */}

          <div
            style={{
              width: "100%",
              height: "320px",
              background: "#eeeeee",
              borderRadius: "12px",
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
                console.log(
                  "Compare image error:",
                  product.image
                );

                e.currentTarget.src =
                  "/images/product1.png";
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          </div>

          {/* NAME */}

          <h2
            style={{
              textAlign: "center",
              margin:
                "15px 0 5px",
            }}
          >
            {product.name}
          </h2>

          {/* CATEGORY */}

          <p
            style={{
              textAlign: "center",
              color: "#666",
              margin: "5px",
            }}
          >
            {product.category ||
              "Product"}
          </p>

          {/* JUSTBRAND PRICE */}

          <h2
            style={{
              textAlign: "center",
              color: "#ff6b00",
              margin: "10px",
            }}
          >
            ₹{justBrandPrice}
          </h2>

          {/* =================================
              SLIDER BUTTONS
          ================================= */}

          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              marginTop: "20px",
            }}
          >
            <button
              onClick={
                previousProduct
              }
              style={{
                width: "55px",
                height: "45px",
                background:
                  "#ff6b00",
                color: "white",
                border: "none",
                borderRadius:
                  "8px",
                cursor: "pointer",
                fontSize: "24px",
              }}
            >
              ←
            </button>

            <strong>
              {current + 1} /{" "}
              {visibleProducts.length}
            </strong>

            <button
              onClick={nextProduct}
              style={{
                width: "55px",
                height: "45px",
                background:
                  "#ff6b00",
                color: "white",
                border: "none",
                borderRadius:
                  "8px",
                cursor: "pointer",
                fontSize: "24px",
              }}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* =================================
          COMPARISON TITLE
      ================================= */}

      <div
        style={{
          maxWidth: "1100px",
          margin:
            "30px auto 15px",
        }}
      >
        <h2
          style={{
            marginBottom: "5px",
          }}
        >
          💰 Compare Prices
        </h2>

        <p
          style={{
            color: "#666",
          }}
        >
          {product.name} की कीमत अलग-अलग
          shopping sites पर compare करें
        </p>
      </div>

      {/* =================================
          COMPARISON CARDS
      ================================= */}

      <div
        style={{
          maxWidth: "1100px",
          margin: "auto",
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(230px, 1fr))",
          gap: "20px",
        }}
      >
        {/* JUSTBRAND */}

        <CompareCard
          site="JustBrand"
          icon="🟠"
          price={justBrandPrice}
          best={
            justBrandPrice ===
            bestPrice
          }
          image={product.image}
          onBuy={() =>
            buyNow("JustBrand")
          }
        />

        {/* AMAZON */}

        <CompareCard
          site="Amazon"
          icon="🟡"
          price={amazonPrice}
          best={
            amazonPrice ===
            bestPrice
          }
          image={product.image}
          onBuy={() =>
            buyNow("Amazon")
          }
        />

        {/* FLIPKART */}

        <CompareCard
          site="Flipkart"
          icon="🔵"
          price={flipkartPrice}
          best={
            flipkartPrice ===
            bestPrice
          }
          image={product.image}
          onBuy={() =>
            buyNow("Flipkart")
          }
        />

        {/* MEESHO */}

        <CompareCard
          site="Meesho"
          icon="🟣"
          price={meeshoPrice}
          best={
            meeshoPrice ===
            bestPrice
          }
          image={product.image}
          onBuy={() =>
            buyNow("Meesho")
          }
        />
      </div>
    </div>
  );
}

// =====================================
// COMPARE CARD
// =====================================

function CompareCard({
  site,
  icon,
  price,
  best,
  image,
  onBuy,
}) {
  const getImage = (image) => {
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

    return `/images/${image
      .split("/")
      .pop()}`;
  };

  return (
    <div
      style={{
        background: "white",
        padding: "18px",
        borderRadius: "15px",
        boxShadow: best
          ? "0 0 0 3px #28a745"
          : "0 2px 8px #ddd",
        position: "relative",
      }}
    >
      {best && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background:
              "#28a745",
            color: "white",
            padding: "5px 8px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "bold",
          }}
        >
          🏆 Best Price
        </div>
      )}

      <h3>
        {icon} {site}
      </h3>

      <div
        style={{
          height: "150px",
          background: "#f5f5f5",
          borderRadius: "10px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={getImage(image)}
          alt={site}
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

      <h2
        style={{
          color: "#ff6b00",
        }}
      >
        ₹{price}
      </h2>

      <p>
        ⭐ 4.5 Rating
      </p>

      <p
        style={{
          color: "green",
        }}
      >
        ✓ Available
      </p>

      <button
        onClick={onBuy}
        style={{
          width: "100%",
          padding: "12px",
          background:
            best
              ? "#28a745"
              : "#ff6b00",
          color: "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        🛒 Buy Now
      </button>
    </div>
  );
}

export default ComparePrice;
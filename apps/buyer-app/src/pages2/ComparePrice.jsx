
import React, { useEffect, useState } from "react";

function ComparePrice({
  products = [],
  selectedProduct = null,
  onBack,
  onRemove,
  onBuyNow,
}) {
  const [current, setCurrent] = useState(0);
  const [search, setSearch] = useState("");

  // =====================================
  // IMAGE URL
  // =====================================

  const getImageUrl = (image) => {
    if (!image) {
      return "/images/product1.png";
    }

    const imageValue = String(image).trim();

    if (!imageValue) {
      return "/images/product1.png";
    }

    // Full external URL
    if (
      imageValue.startsWith("http://") ||
      imageValue.startsWith("https://")
    ) {
      return imageValue;
    }

    // Local public image
    if (imageValue.startsWith("/images/")) {
      return imageValue;
    }

    // Other local public path
    if (imageValue.startsWith("/")) {
      return imageValue;
    }

    // Filename only
    const fileName = imageValue.split("/").pop();

    return `/images/${fileName}`;
  };

  // =====================================
  // SELECTED PRODUCT FIRST
  // =====================================

  const orderedProducts = selectedProduct
    ? [
        selectedProduct,
        ...products.filter(
          (product) =>
            String(product.id) !==
            String(selectedProduct.id)
        ),
      ]
    : products;

  // =====================================
  // SEARCH
  // =====================================

  const visibleProducts = orderedProducts.filter(
    (product) =>
      String(product.name || "")
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  // =====================================
  // SELECTED PRODUCT POSITION
  // =====================================

  useEffect(() => {
    if (!selectedProduct) {
      setCurrent(0);
      return;
    }

    const index = visibleProducts.findIndex(
      (product) =>
        String(product.id) ===
        String(selectedProduct.id)
    );

    setCurrent(index >= 0 ? index : 0);
  }, [selectedProduct, search]);

  // =====================================
  // CURRENT PRODUCT
  // =====================================

  const product =
    visibleProducts.length > 0
      ? visibleProducts[current] ||
        visibleProducts[0]
      : null;

  // =====================================
  // NEXT PRODUCT
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
  // PREVIOUS PRODUCT
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
    if (site === "JustBrand" && selectedProduct && onBuyNow) {
      // Real checkout for JustBrand products.
      onBuyNow(selectedProduct);
      return;
    }

    alert(
      `${site} link will be connected with authorized API / affiliate integration at final stage.`
    );
  };

  // =====================================
  // REMOVE
  // =====================================

  const handleRemove = () => {
    if (!product || !onRemove) {
      return;
    }

    onRemove(product.id);
    setCurrent(0);
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
          <h2>⚖️ Compare Price</h2>

          <p>
            No product available for comparison.
          </p>
        </div>
      </div>
    );
  }

  // =====================================
  // CURRENT PRODUCT IMAGE
  // =====================================

  const productImage = getImageUrl(product.image);

  console.log("COMPARE PRODUCT:", product);
console.log("COMPARE IMAGE:", product.image);
console.log("COMPARE IMAGE URL:", productImage);

  // =====================================
  // PRICE
  // =====================================

  const justBrandPrice =
    Number(
      String(product.price || "0")
        .replace("₹", "")
        .replace(/,/g, "")
        .trim()
    ) || 0;

  const amazonPrice =
    justBrandPrice > 0
      ? Math.max(1, justBrandPrice - 50)
      : 949;

  const flipkartPrice =
    justBrandPrice > 0
      ? Math.max(1, justBrandPrice - 30)
      : 969;

  const meeshoPrice =
    justBrandPrice > 0
      ? Math.max(1, justBrandPrice - 80)
      : 919;

  const prices = [
    justBrandPrice,
    amazonPrice,
    flipkartPrice,
    meeshoPrice,
  ].filter((price) => price > 0);

  const bestPrice =
    prices.length > 0
      ? Math.min(...prices)
      : 0;

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
          flexWrap: "wrap",
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

        {onRemove && (
          <button
            onClick={handleRemove}
            style={{
              marginLeft: "auto",
              background: "#dc3545",
              color: "white",
              border: "none",
              padding: "10px 15px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            🗑 Remove
          </button>
        )}
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
          SELECTED PRODUCT
      ================================= */}

      {selectedProduct && (
        <div
          style={{
            maxWidth: "700px",
            margin: "0 auto 20px",
            background:
              "linear-gradient(135deg, #fff7ed, #fff)",
            border: "1px solid #ffd6a8",
            borderRadius: "12px",
            padding: "12px 16px",
            textAlign: "center",
          }}
        >
          <strong>
            🔎 Comparing selected product:
          </strong>{" "}
          {selectedProduct.name}
        </div>
      )}

      {/* =================================
          MAIN PRODUCT
      ================================= */}

      <div
        style={{
          maxWidth: "580px",
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
              height: "380px",
              background: "#eeeeee",
              borderRadius: "12px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden",
              padding: "14px",
              boxSizing: "border-box",
            }}
          >
            <img
              src={productImage}
              alt={product.name || "Product"}
              onError={(e) => {
                console.log(
                  "Compare product image error:",
                  product.image
                );

                if (
                  e.currentTarget.src.endsWith(
                    "/images/product1.png"
                  )
                ) {
                  return;
                }

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
              margin: "15px 0 5px",
            }}
          >
            {product.name}
          </h2>

          {/* SELLER */}

          {product.sellerName && (
            <p
              style={{
                textAlign: "center",
                color: "#555",
                margin: "5px",
                fontWeight: "500",
              }}
            >
              Seller: {product.sellerName}
            </p>
          )}

          {/* CATEGORY */}

          <p
            style={{
              textAlign: "center",
              color: "#666",
              margin: "5px",
            }}
          >
            {product.category || "Product"}
          </p>

          {/* PRICE */}

          <h2
            style={{
              textAlign: "center",
              color: "#ff6b00",
              margin: "10px",
            }}
          >
            ₹{justBrandPrice.toLocaleString("en-IN")}
          </h2>

          {/* =================================
              SLIDER BUTTONS
          ================================= */}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "20px",
            }}
          >
            <button
              onClick={previousProduct}
              style={{
                width: "55px",
                height: "45px",
                background: "#ff6b00",
                color: "white",
                border: "none",
                borderRadius: "8px",
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
                background: "#ff6b00",
                color: "white",
                border: "none",
                borderRadius: "8px",
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
          margin: "30px auto 15px",
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
            justBrandPrice === bestPrice
          }
          image={productImage}
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
            amazonPrice === bestPrice
          }
          image={productImage}
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
            flipkartPrice === bestPrice
          }
          image={productImage}
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
            meeshoPrice === bestPrice
          }
          image={productImage}
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
      {/* BEST PRICE */}

      {best && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "#28a745",
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

      {/* SITE */}

      <h3>
        {icon} {site}
      </h3>

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
          padding: "8px",
          boxSizing: "border-box",
        }}
      >
        <img
          src={image || "/images/product1.png"}
          alt={site}
          onError={(e) => {
            console.log(
              `${site} image error:`,
              image
            );

            if (
              !e.currentTarget.src.endsWith(
                "/images/product1.png"
              )
            ) {
              e.currentTarget.src =
                "/images/product1.png";
            }
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>

      {/* PRICE */}

      <h2
        style={{
          color: "#ff6b00",
        }}
      >
        ₹{Number(price || 0).toLocaleString("en-IN")}
      </h2>

      {/* RATING */}

      <p>
        ⭐ 4.5 Rating
      </p>

      {/* AVAILABILITY */}

      <p
        style={{
          color: "green",
        }}
      >
        ✓ Available
      </p>

      {/* BUY */}

      <button
        onClick={onBuy}
        style={{
          width: "100%",
          padding: "12px",
          background: best
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

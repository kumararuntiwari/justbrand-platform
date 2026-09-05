import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

function ComparePriceSlider({
  products = [],
  onCompare,
}) {
  const [search, setSearch] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  const sliderRef = useRef(null);

  // =====================================
  // FORMAT PRICE
  // =====================================

  const formatPrice = (value) => {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "₹0";
    }

    const text = String(value);

    return text.includes("₹")
      ? text
      : `₹${text}`;
  };

  // =====================================
  // SEARCH
  // =====================================

  const searchText = search
    .toLowerCase()
    .trim();

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const name = String(
        product?.name || ""
      ).toLowerCase();

      const category = String(
        product?.category || ""
      ).toLowerCase();

      return (
        name.includes(searchText) ||
        category.includes(searchText)
      );
    });
  }, [products, searchText]);

  // =====================================
  // RESET SLIDER
  // =====================================

  useEffect(() => {
    setCurrentIndex(0);

    if (sliderRef.current) {
      sliderRef.current.scrollTo({
        left: 0,
        behavior: "smooth",
      });
    }
  }, [searchText]);

  // =====================================
  // AUTO SLIDER
  // =====================================

  useEffect(() => {
    if (filteredProducts.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        if (
          prev >=
          filteredProducts.length - 1
        ) {
          return 0;
        }

        return prev + 1;
      });
    }, 3000);

    return () => {
      clearInterval(timer);
    };
  }, [filteredProducts.length]);

  // =====================================
  // MOVE SLIDER
  // =====================================

  useEffect(() => {
    const container = sliderRef.current;

    if (!container) {
      return;
    }

    const card =
      container.children[currentIndex];

    if (!card) {
      return;
    }

    const containerWidth =
      container.clientWidth;

    const cardWidth =
      card.offsetWidth;

    const cardLeft =
      card.offsetLeft;

    const targetScroll =
      cardLeft -
      containerWidth / 2 +
      cardWidth / 2;

    container.scrollTo({
      left: Math.max(
        0,
        targetScroll
      ),
      behavior: "smooth",
    });
  }, [
    currentIndex,
    filteredProducts.length,
  ]);

  // =====================================
  // SELECT PRODUCT
  // =====================================

  const selectProduct = (product) => {
    if (onCompare) {
      onCompare(product);
    }
  };

  // =====================================
  // PREVIOUS
  // =====================================

  const previous = () => {
    if (filteredProducts.length === 0) {
      return;
    }

    setCurrentIndex((prev) => {
      if (prev <= 0) {
        return filteredProducts.length - 1;
      }

      return prev - 1;
    });
  };

  // =====================================
  // NEXT
  // =====================================

  const next = () => {
    if (filteredProducts.length === 0) {
      return;
    }

    setCurrentIndex((prev) => {
      if (
        prev >=
        filteredProducts.length - 1
      ) {
        return 0;
      }

      return prev + 1;
    });
  };

  // =====================================
  // RETURN
  // =====================================

  return (
    <section
      style={{
        width: "100%",
        marginTop: "35px",
        background: "#ffffff",
        borderRadius: "16px",
        padding: "20px",
        boxShadow:
          "0 3px 14px rgba(0,0,0,0.09)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* =================================
          HEADER
      ================================= */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "15px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        {/* TITLE */}

        <div>
          <h2
            style={{
              margin: 0,
              color: "#222",
              fontSize: "22px",
              fontWeight: "700",
            }}
          >
            ⚖️ Compare Products
          </h2>

          <p
            style={{
              margin: "5px 0 0",
              color: "#777",
              fontSize: "14px",
            }}
          >
            Select products and compare
            their prices
          </p>
        </div>

        {/* SEARCH */}

        <div
          style={{
            display: "flex",
            gap: "8px",
            width: "100%",
            maxWidth: "400px",
          }}
        >
          <input
            type="text"
            placeholder="🔎 Search Products"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "11px 14px",
              border:
                "1px solid #d5d5d5",
              borderRadius: "8px",
              outline: "none",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />

          <button
            type="button"
            onClick={() => {
              setCurrentIndex(0);
            }}
            style={{
              padding: "10px 18px",
              background:
                "linear-gradient(135deg, #ff6b00, #ff1493)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "bold",
              flexShrink: 0,
            }}
          >
            Search
          </button>
        </div>
      </div>

      {/* =================================
          SLIDER
      ================================= */}

      {filteredProducts.length > 0 ? (
        <div
          style={{
            position: "relative",
            width: "100%",
          }}
        >
          {/* LEFT */}

          {filteredProducts.length > 1 && (
            <button
              type="button"
              onClick={previous}
              aria-label="Previous products"
              style={{
                position: "absolute",
                left: "5px",
                top: "50%",
                transform:
                  "translateY(-50%)",
                zIndex: 10,
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                border: "none",
                background:
                  "linear-gradient(135deg, #ff6b00, #ff1493)",
                color: "white",
                fontSize: "26px",
                cursor: "pointer",
                boxShadow:
                  "0 3px 10px rgba(0,0,0,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ‹
            </button>
          )}

          {/* PRODUCTS */}

          <div
            ref={sliderRef}
            style={{
              width: "100%",
              display: "flex",
              gap: "16px",
              overflowX: "auto",
              overflowY: "hidden",
              padding: "10px 52px",
              boxSizing: "border-box",
              scrollBehavior: "smooth",
              scrollbarWidth: "none",
              overscrollBehaviorX: "contain",
              overscrollBehaviorY: "none",
              touchAction: "pan-x",
            }}
          >
            {filteredProducts.map(
              (product, index) => {
                const image =
                  product?.image ||
                  "/images/product1.png";

                const name =
                  product?.name ||
                  "Product";

                const price =
                  product?.price;

                return (
                  <div
                    key={
                      product?.id ??
                      `${name}-${index}`
                    }
                    onClick={() => {
                      selectProduct(product);
                    }}
                    style={{
                      minWidth: "195px",
                      maxWidth: "195px",
                      flex:
                        "0 0 195px",
                      background:
                        "#ffffff",
                      border:
                        "1px solid #e5e5e5",
                      borderRadius: "13px",
                      padding: "10px",
                      cursor: "pointer",
                      textAlign: "center",
                      boxSizing: "border-box",
                      transition:
                        "transform 0.2s ease, box-shadow 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform =
                        "translateY(-3px)";

                      e.currentTarget.style.boxShadow =
                        "0 6px 16px rgba(0,0,0,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform =
                        "translateY(0)";

                      e.currentTarget.style.boxShadow =
                        "none";
                    }}
                  >
                    {/* IMAGE */}

                    <div
                      style={{
                        width: "100%",
                        height: "150px",
                        background:
                          "#f7f7f7",
                        borderRadius: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <img
                        src={image}
                        alt={name}
                        onError={(e) => {
                          e.currentTarget.src =
                            "/images/product1.png";
                        }}
                        style={{
                          width: "100%",
                          height: "150px",
                          objectFit: "contain",
                          display: "block",
                        }}
                      />
                    </div>

                    {/* NAME */}

                    <h3
                      style={{
                        fontSize: "15px",
                        margin:
                          "10px 0 6px",
                        color: "#222",
                        fontWeight: "600",
                        whiteSpace:
                          "nowrap",
                        overflow:
                          "hidden",
                        textOverflow:
                          "ellipsis",
                      }}
                    >
                      {name}
                    </h3>

                    {/* PRICE */}

                    <div
                      style={{
                        fontWeight: "700",
                        color: "#ff6b00",
                        fontSize: "18px",
                        marginBottom: "9px",
                      }}
                    >
                      {formatPrice(price)}
                    </div>

                    {/* COMPARE */}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();

                        selectProduct(product);
                      }}
                      style={{
                        width: "100%",
                        padding: "9px",
                        background:
                          "linear-gradient(135deg, #ff1493, #ff6b00)",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontWeight: "700",
                        fontSize: "13px",
                      }}
                    >
                      ⚖️ Compare Price
                    </button>
                  </div>
                );
              }
            )}
          </div>

          {/* RIGHT */}

          {filteredProducts.length > 1 && (
            <button
              type="button"
              onClick={next}
              aria-label="Next products"
              style={{
                position: "absolute",
                right: "5px",
                top: "50%",
                transform:
                  "translateY(-50%)",
                zIndex: 10,
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                border: "none",
                background:
                  "linear-gradient(135deg, #ff6b00, #ff1493)",
                color: "white",
                fontSize: "26px",
                cursor: "pointer",
                boxShadow:
                  "0 3px 10px rgba(0,0,0,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ›
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: "35px 20px",
            textAlign: "center",
            color: "#777",
          }}
        >
          <div
            style={{
              fontSize: "40px",
              marginBottom: "8px",
            }}
          >
            🔍
          </div>

          <h3
            style={{
              margin: "0 0 5px",
              color: "#333",
            }}
          >
            No products found
          </h3>

          <p
            style={{
              margin: 0,
              fontSize: "14px",
            }}
          >
            Try another product name or
            category.
          </p>
        </div>
      )}
    </section>
  );
}

export default ComparePriceSlider;
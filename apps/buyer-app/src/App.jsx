import React, { useEffect, useState } from "react";

import Header from "./components/Header";
import ProductCard from "./components/ProductCard";
import ComparePriceSlider from "./components/ComparePriceSlider";

import ProductDetails from "./pages2/ProductDetails";
import Cart from "./pages2/Cart";
import ComparePrice from "./pages2/ComparePrice";

const BACKEND_URL =
  "http://localhost:5000/api/products";

function App() {
  // =====================================
  // CART
  // =====================================

  const [cart, setCart] = useState(() => {
    try {
      const saved =
        localStorage.getItem(
          "justbrand_cart"
        );

      return saved
        ? JSON.parse(saved)
        : [];
    } catch {
      return [];
    }
  });

  // =====================================
  // WISHLIST
  // =====================================

  const [wishlist, setWishlist] = useState(
    () => {
      try {
        const saved =
          localStorage.getItem(
            "justbrand_wishlist"
          );

        return saved
          ? JSON.parse(saved)
          : [];
      } catch {
        return [];
      }
    }
  );

  // =====================================
  // PRODUCTS
  // =====================================

  const [products, setProducts] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  // =====================================
  // SELECTED PRODUCT
  // =====================================

  const [selectedProduct, setSelectedProduct] =
    useState(null);

  // =====================================
  // CART PAGE
  // =====================================

  const [showCart, setShowCart] =
    useState(false);

  // =====================================
  // COMPARE PRODUCTS
  // =====================================

  const [compareProducts, setCompareProducts] =
    useState([]);

  const [showCompare, setShowCompare] =
    useState(false);

  // =====================================
  // SEARCH
  // =====================================

  const [search, setSearch] =
    useState("");

  // =====================================
  // CATEGORY
  // =====================================

  const [category, setCategory] =
    useState("All");

  // =====================================
  // LOAD PRODUCTS
  // =====================================

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);

    try {
      const response = await fetch(
        BACKEND_URL
      );

      if (!response.ok) {
        throw new Error(
          "Backend response failed"
        );
      }

      const data =
        await response.json();

      console.log(
        "Products received:",
        data
      );

      const backendProducts =
        Array.isArray(data)
          ? data
          : Array.isArray(data.products)
          ? data.products
          : [];

      setProducts(
        backendProducts
      );
    } catch (error) {
      console.error(
        "Backend loading error:",
        error
      );

      // Seller products from localStorage
      try {
        const localSellerProducts =
          localStorage.getItem(
            "justbrand_products"
          );

        if (localSellerProducts) {
          setProducts(
            JSON.parse(
              localSellerProducts
            )
          );
        } else {
          setProducts([]);
        }
      } catch {
        setProducts([]);
      }
    }

    setLoading(false);
  };

  // =====================================
  // ADD TO CART
  // =====================================

  const addToCart = (product) => {
    setCart((prevCart) => {
      const existingProduct =
        prevCart.find(
          (item) =>
            item.id === product.id
        );

      let updatedCart;

      if (existingProduct) {
        updatedCart =
          prevCart.map((item) =>
            item.id === product.id
              ? {
                  ...item,
                  quantity:
                    (item.quantity ||
                      1) + 1,
                }
              : item
          );
      } else {
        updatedCart = [
          ...prevCart,
          {
            ...product,
            quantity: 1,
          },
        ];
      }

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(
          updatedCart
        )
      );

      return updatedCart;
    });

    alert(
      "Product added to cart!"
    );
  };

  // =====================================
  // REMOVE CART
  // =====================================

  const removeFromCart = (id) => {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.filter(
          (item) =>
            item.id !== id
        );

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(
          updatedCart
        )
      );

      return updatedCart;
    });
  };

  // =====================================
  // UPDATE QUANTITY
  // =====================================

  const updateQuantity = (
    id,
    quantity
  ) => {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.map((item) =>
          item.id === id
            ? {
                ...item,
                quantity:
                  Math.max(
                    1,
                    Number(
                      quantity
                    )
                  ),
              }
            : item
        );

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(
          updatedCart
        )
      );

      return updatedCart;
    });
  };

  // =====================================
  // WISHLIST
  // =====================================

  const addToWishlist = (
    product
  ) => {
    setWishlist(
      (prevWishlist) => {
        const alreadyAdded =
          prevWishlist.some(
            (item) =>
              item.id ===
              product.id
          );

        if (alreadyAdded) {
          return prevWishlist;
        }

        const updatedWishlist = [
          ...prevWishlist,
          product,
        ];

        localStorage.setItem(
          "justbrand_wishlist",
          JSON.stringify(
            updatedWishlist
          )
        );

        return updatedWishlist;
      }
    );

    alert(
      "Added to wishlist!"
    );
  };

  // =====================================
  // COMPARE PRODUCT
  // =====================================

  const onCompare = (product) => {
    setCompareProducts(
      (prev) => {
        const alreadyExists =
          prev.some(
            (item) =>
              item.id ===
              product.id
          );

        if (alreadyExists) {
          setShowCompare(true);
          return prev;
        }

        if (prev.length >= 4) {
          alert(
            "You can compare maximum 4 products."
          );

          return prev;
        }

        return [
          ...prev,
          product,
        ];
      }
    );

    setShowCompare(true);
  };

  // =====================================
  // COMPARE SLIDER PRODUCT
  // =====================================

  const compareSingleProduct = (
    product
  ) => {
    setCompareProducts([
      product,
    ]);

    setShowCompare(true);
  };

  // =====================================
  // REMOVE COMPARE
  // =====================================

  const removeCompare = (id) => {
    setCompareProducts(
      (prev) =>
        prev.filter(
          (item) =>
            item.id !== id
        )
    );
  };

  // =====================================
  // FILTER PRODUCTS
  // =====================================

  const filteredProducts =
    products.filter(
      (product) => {
        const productName =
          String(
            product.name || ""
          ).toLowerCase();

        const productDetails =
          String(
            product.shortDetails ||
              product.description ||
              ""
          ).toLowerCase();

        const productCategory =
          String(
            product.category ||
              ""
          );

        const searchText =
          search.toLowerCase();

        const matchesSearch =
          productName.includes(
            searchText
          ) ||
          productDetails.includes(
            searchText
          );

        const matchesCategory =
          category === "All" ||
          productCategory ===
            category;

        return (
          matchesSearch &&
          matchesCategory
        );
      }
    );

  // =====================================
  // SEARCH SUGGESTIONS
  // =====================================

  const filteredCategories = [
    ...new Set(
      products
        .map(
          (product) =>
            product.category
        )
        .filter(Boolean)
    ),
  ].filter((cat) =>
    cat
      .toLowerCase()
      .includes(
        search.toLowerCase()
      )
  );

  // =====================================
  // CART COUNT
  // =====================================

  const cartCount =
    cart.reduce(
      (total, item) =>
        total +
        (Number(
          item.quantity
        ) || 1),
      0
    );

  // =====================================
  // GO HOME
  // =====================================

  const goHome = () => {
    setSelectedProduct(null);
    setShowCart(false);
    setShowCompare(false);
  };

  // =====================================
  // PRODUCT DETAILS
  // =====================================

  if (selectedProduct) {
    return (
      <>
        <Header
          cartCount={cartCount}
          search={search}
          setSearch={setSearch}
          onCartClick={() =>
            setShowCart(true)
          }
          filteredProducts={
            filteredProducts
          }
          filteredCategories={
            filteredCategories
          }
          onProductSelect={
            setSelectedProduct
          }
        />

        <ProductDetails
          product={
            selectedProduct
          }
          onBack={() =>
            setSelectedProduct(
              null
            )
          }
          addToCart={
            addToCart
          }
        />
      </>
    );
  }

  // =====================================
  // CART PAGE
  // =====================================

  if (showCart) {
    return (
      <>
        <Header
          cartCount={cartCount}
          search={search}
          setSearch={setSearch}
          onCartClick={() => {}}
          filteredProducts={
            filteredProducts
          }
          filteredCategories={
            filteredCategories
          }
          onProductSelect={
            setSelectedProduct
          }
        />

        <Cart
          cart={cart}
          onBack={() =>
            setShowCart(false)
          }
          removeFromCart={
            removeFromCart
          }
          updateQuantity={
            updateQuantity
          }
        />
      </>
    );
  }

  // =====================================
  // COMPARE PAGE
  // =====================================

  if (showCompare) {
    return (
      <>
        <Header
          cartCount={cartCount}
          search={search}
          setSearch={setSearch}
          onCartClick={() =>
            setShowCart(true)
          }
          filteredProducts={
            filteredProducts
          }
          filteredCategories={
            filteredCategories
          }
          onProductSelect={
            setSelectedProduct
          }
        />

        <ComparePrice
          products={
            compareProducts
          }
          onBack={() =>
            setShowCompare(false)
          }
          onRemove={
            removeCompare
          }
        />
      </>
    );
  }

  // =====================================
  // MAIN BUYER PAGE
  // =====================================

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
      }}
    >
      {/* =================================
          HEADER
      ================================= */}

      <Header
        cartCount={cartCount}
        search={search}
        setSearch={setSearch}
        onCartClick={() =>
          setShowCart(true)
        }
        filteredProducts={
          filteredProducts
        }
        filteredCategories={
          filteredCategories
        }
        onProductSelect={
          setSelectedProduct
        }
      />

      {/* =================================
          CATEGORY BAR
      ================================= */}

      <div
        style={{
          background: "white",
          padding: "15px",
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          borderBottom:
            "1px solid #ddd",
        }}
      >
        {[
          "All",
          "Electronics",
          "Fashion",
          "Beauty",
          "Home",
          "Grocery",
        ].map((item) => (
          <button
            key={item}
            onClick={() =>
              setCategory(item)
            }
            style={{
              padding:
                "9px 16px",
              borderRadius:
                "20px",
              border:
                "1px solid #ddd",
              background:
                category === item
                  ? "#ff6b00"
                  : "white",
              color:
                category === item
                  ? "white"
                  : "#333",
              cursor:
                "pointer",
              whiteSpace:
                "nowrap",
            }}
          >
            {item}
          </button>
        ))}
      </div>

      {/* =================================
          PAGE CONTENT
      ================================= */}

      <div
        style={{
          maxWidth: "1200px",
          margin: "auto",
          padding: "20px",
        }}
      >
        {/* =================================
            JUSTBRAND PRODUCTS TITLE
        ================================= */}

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
            flexWrap:
              "wrap",
            gap: "10px",
          }}
        >
          <div>
            <h2
              style={{
                marginBottom:
                  "5px",
              }}
            >
              JustBrand Products
            </h2>

            <p
              style={{
                color: "#666",
                marginTop: 0,
              }}
            >
              Best products at
              best prices
            </p>
          </div>

          {/* COMPARE COUNT */}

          {compareProducts.length >
            0 && (
            <button
              onClick={() =>
                setShowCompare(
                  true
                )
              }
              style={{
                background:
                  "#ff1493",
                color:
                  "white",
                border:
                  "none",
                padding:
                  "10px 18px",
                borderRadius:
                  "8px",
                cursor:
                  "pointer",
                fontWeight:
                  "bold",
              }}
            >
              ⚖️ Compare (
              {
                compareProducts.length
              }
              )
            </button>
          )}
        </div>

        {/* =================================
            LOADING
        ================================= */}

        {loading && (
          <div
            style={{
              background:
                "white",
              padding:
                "40px",
              textAlign:
                "center",
              borderRadius:
                "12px",
              marginTop:
                "20px",
            }}
          >
            <h3>
              Loading products...
            </h3>
          </div>
        )}

        {/* =================================
            PRODUCTS GRID
        ================================= */}

        {!loading &&
          filteredProducts.length >
            0 && (
            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "20px",
              }}
            >
              {filteredProducts.map(
                (product) => (
                  <ProductCard
                    key={
                      product.id
                    }
                    product={
                      product
                    }
                    addToCart={
                      addToCart
                    }
                    addToWishlist={
                      addToWishlist
                    }
                    onSelect={
                      setSelectedProduct
                    }
                    onCompare={
                      onCompare
                    }
                  />
                )
              )}
            </div>
          )}

        {/* =================================
            NO PRODUCTS
        ================================= */}

        {!loading &&
          filteredProducts.length ===
            0 && (
            <div
              style={{
                background:
                  "white",
                padding:
                  "40px",
                borderRadius:
                  "12px",
                textAlign:
                  "center",
                marginTop:
                  "20px",
              }}
            >
              <h3>
                No products found
              </h3>

              <p>
                Please try another
                search or category.
              </p>

              <button
                onClick={() => {
                  setSearch("");
                  setCategory(
                    "All"
                  );
                }}
                style={{
                  background:
                    "#ff6b00",
                  color:
                    "white",
                  border:
                    "none",
                  padding:
                    "10px 20px",
                  borderRadius:
                    "7px",
                  cursor:
                    "pointer",
                }}
              >
                Show All Products
              </button>
            </div>
          )}

        {/* =================================
            COMPARE PRICE SLIDER
        ================================= */}

        {!loading &&
          products.length > 0 && (
            <ComparePriceSlider
              products={products}
              onCompare={
                compareSingleProduct
              }
            />
          )}
      </div>
    </div>
  );
}

export default App;
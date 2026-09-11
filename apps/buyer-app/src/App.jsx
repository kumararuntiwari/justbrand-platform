import ProductCard from "./components/ProductCard";
import ComparePriceSlider from "./components/ComparePriceSlider";
import Header from "./components/Header";
import { useState, useEffect } from 'react';
import ProductDetails from "./pages2/ProductDetails";
import Cart from "./pages2/Cart";
import ComparePrice from "./pages2/ComparePrice";

// ==========================================
// MLM PAGES
// ==========================================

import MLMCommission from "./Pages/MLMCommission";
import MLMCommissionRules from "./Pages/MLMCommissionRules";
import MLMDashboard from "./Pages/MLMDashboard";
import MLMLogin from "./Pages/MLMLogin";
import MLMRegister from "./Pages/MLMRegister";
import MLMTree from "./Pages/MLMTree";
import MLMWallet from "./Pages/MLMWallet";

// ==========================================
// BACKEND
// ==========================================

const BACKEND_URL = "https://justbrand-in-144629.hostingersite.com/api/products";

// ==========================================
// APP
// ==========================================

function App() {
  // ==========================================
  // CART
  // ==========================================

  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_cart");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // ==========================================
  // WISHLIST
  // ==========================================

  const [wishlist, setWishlist] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_wishlist");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // ==========================================
  // PRODUCTS
  // ==========================================

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // ==========================================
  // SHOPPING PAGES
  // ==========================================

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCart, setShowCart] = useState(false);

  // ==========================================
  // COMPARE
  // ==========================================

  const [compareProducts, setCompareProducts] = useState([]);
  const [compareSelectedProduct, setCompareSelectedProduct] =
    useState(null);
  const [showCompare, setShowCompare] = useState(false);

  // ==========================================
  // SEARCH
  // ==========================================

  const [search, setSearch] = useState("");

  // ==========================================
  // CATEGORY
  // ==========================================

  const [category, setCategory] = useState("All");

  // ==========================================
  // MLM PAGE
  // ==========================================

  const [mlmPage, setMlmPage] = useState(null);

  // ==========================================
  // MLM MEMBER
  // ==========================================

  const [mlmMember, setMlmMember] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_mlm_member");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // ==========================================
  // LOAD PRODUCTS
  // ==========================================

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);

    let loadedProducts = [];

    // ========================================
    // BACKEND PRODUCTS
    // ========================================

    try {
      const response = await fetch(BACKEND_URL);

      if (response.ok) {
        const data = await response.json();

        console.log("Backend products:", data);

        if (Array.isArray(data)) {
          loadedProducts = data;
        } else if (
          data &&
          Array.isArray(data.products)
        ) {
          loadedProducts = data.products;
        }
      } else {
        console.log(
          "Backend response error:",
          response.status
        );
      }
    } catch (error) {
      console.log(
        "Backend unavailable:",
        error
      );
    }

    // ========================================
    // NORMALIZE PRODUCTS
    // ========================================

    const normalizedProducts =
      loadedProducts.map(
        (product, index) => {
          let image =
            product.image ||
            product.imageUrl ||
            product.photo ||
            product.thumbnail ||
            "";

          // ======================================
          // IMAGE NORMALIZATION
          // ======================================

          if (
            image &&
            String(image).startsWith("data:image/")
          ) {
            // Base64 image - keep unchanged
          } else {
            image = String(image);

            // Windows path
            if (image.includes("\\")) {
              image = image.split("\\").pop();
            }

            // Remove public/images path
            image = image.replace(
              /^.*[\/\\]public[\/\\]images[\/\\]/i,
              ""
            );

            // Remove /images/ or images/
            image = image.replace(
              /^\/?images[\/\\]/i,
              ""
            );

            if (image) {
              image = "/images/" + image;
            }
          }

          // ======================================
          // FALLBACK IMAGE
          // ======================================

          if (!image) {
            const fallbackImages = [
              "/images/product1.png",
              "/images/product2.jpeg",
              "/images/product3.jpeg",
              "/images/product4.jpg",
            ];

            image =
              fallbackImages[
                index % fallbackImages.length
              ];
          }

          // ======================================
          // FINAL PRODUCT
          // ======================================

          return {
            ...product,

            id:
              product.id !== undefined &&
              product.id !== null
                ? product.id
                : Date.now() + index,

            name:
              product.name ||
              product.productName ||
              "",

            price:
              product.price ||
              "",

            comparePrice:
              product.comparePrice ||
              "",

            category:
              product.category ||
              "",

            shortDetails:
              product.shortDetails ||
              product.description ||
              "",

            description:
              product.description ||
              "",

            sellerId:
              product.sellerId ||
              "",

            sellerName:
              product.sellerName ||
              "",

            image,
          };
        }
      );

    console.log(
      "FINAL PRODUCTS:",
      normalizedProducts
    );

    setProducts(normalizedProducts);
    setLoading(false);
  }

  // ==========================================
  // ADD TO CART
  // ==========================================

  function addToCart(product) {
    setCart((prevCart) => {
      const existingProduct =
        prevCart.find(
          (item) =>
            item.id === product.id
        );

      let updatedCart;

      if (existingProduct) {
        updatedCart =
          prevCart.map((item) => {
            if (
              item.id === product.id
            ) {
              return {
                ...item,
                quantity:
                  (item.quantity || 1) + 1,
              };
            }

            return item;
          });
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
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });

    alert("Product added to cart!");
  }

  // ==========================================
  // REMOVE FROM CART
  // ==========================================

  function removeFromCart(id) {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.filter(
          (item) =>
            item.id !== id
        );

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });
  }

  // ==========================================
  // UPDATE QUANTITY
  // ==========================================

  function updateQuantity(id, quantity) {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.map((item) => {
          if (
            item.id === id
          ) {
            return {
              ...item,
              quantity:
                Math.max(
                  1,
                  Number(quantity) || 1
                ),
            };
          }

          return item;
        });

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });
  }

  // ==========================================
  // WISHLIST
  // ==========================================

  function addToWishlist(product) {
    setWishlist((prevWishlist) => {
      const exists =
        prevWishlist.some(
          (item) =>
            item.id === product.id
        );

      if (exists) {
        alert("Already in wishlist!");
        return prevWishlist;
      }

      const updatedWishlist = [
        ...prevWishlist,
        product,
      ];

      localStorage.setItem(
        "justbrand_wishlist",
        JSON.stringify(updatedWishlist)
      );

      alert("Added to wishlist!");

      return updatedWishlist;
    });
  }

  // ==========================================
  // COMPARE
  // ==========================================

  function onCompare(product) {
    // IMPORTANT:
    // Remember exactly which product
    // user clicked for comparison.
    setCompareSelectedProduct(product);

    setCompareProducts((prevProducts) => {
      const exists =
        prevProducts.some(
          (item) =>
            String(item.id) ===
            String(product.id)
        );

      if (exists) {
        return prevProducts;
      }

      if (
        prevProducts.length >= 4
      ) {
        alert(
          "You can compare maximum 4 products."
        );

        return prevProducts;
      }

      return [
        ...prevProducts,
        product,
      ];
    });

    setShowCompare(true);
  }

  // ==========================================
  // COMPARE SINGLE PRODUCT
  // ==========================================

  function compareSingleProduct(product) {
    onCompare(product);
  }

  // ==========================================
  // REMOVE COMPARE
  // ==========================================

  function removeCompare(id) {
    setCompareProducts(
      (prevProducts) =>
        prevProducts.filter(
          (item) =>
            String(item.id) !==
            String(id)
        )
    );

    // If removed product was selected,
    // select another available product.
    setCompareSelectedProduct(
      (prevSelected) => {
        if (
          prevSelected &&
          String(prevSelected.id) ===
            String(id)
        ) {
          const remaining =
            compareProducts.filter(
              (item) =>
                String(item.id) !==
                String(id)
            );

          return remaining.length > 0
            ? remaining[0]
            : null;
        }

        return prevSelected;
      }
    );
  }

  // ==========================================
  // FILTER PRODUCTS
  // ==========================================

  const filteredProducts =
    products.filter((product) => {
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
          product.category || ""
        );

      const searchText =
        search
          .toLowerCase()
          .trim();

      const matchesSearch =
        productName.includes(
          searchText
        ) ||
        productDetails.includes(
          searchText
        );

      const matchesCategory =
        category === "All" ||
        productCategory === category;

      return (
        matchesSearch &&
        matchesCategory
      );
    });

  // ==========================================
  // SEARCH CATEGORIES
  // ==========================================

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
    String(cat)
      .toLowerCase()
      .includes(
        search.toLowerCase()
      )
  );

  // ==========================================
  // CART COUNT
  // ==========================================

  const cartCount =
    cart.reduce(
      (total, item) =>
        total +
        (Number(item.quantity) || 1),
      0
    );

  // ==========================================
  // COMMON HEADER PROPS
  // ==========================================

  const commonHeaderProps = {
    cartCount,
    search,
    setSearch,
    filteredProducts,
    filteredCategories,
    onProductSelect:
      setSelectedProduct,
  };

  // ==========================================
  // MLM LOGIN
  // ==========================================

  if (mlmPage === "login") {
    return (
      <MLMLogin
        onLogin={(member) => {
          setMlmMember(member);

          localStorage.setItem(
            "justbrand_mlm_member",
            JSON.stringify(member)
          );

          setMlmPage("dashboard");
        }}
        onRegister={() =>
          setMlmPage("register")
        }
        onBack={() =>
          setMlmPage(null)
        }
      />
    );
  }

  // ==========================================
  // MLM REGISTER
  // ==========================================

  if (mlmPage === "register") {
    return (
      <MLMRegister
        onRegistered={(member) => {
          setMlmMember(member);

          localStorage.setItem(
            "justbrand_mlm_member",
            JSON.stringify(member)
          );

          setMlmPage("dashboard");
        }}
        onBack={() =>
          setMlmPage(null)
        }
      />
    );
  }

  // ==========================================
  // MLM DASHBOARD
  // ==========================================

  if (mlmPage === "dashboard") {
    return (
      <MLMDashboard
        member={mlmMember}
        onBack={() =>
          setMlmPage(null)
        }
        onCommission={() =>
          setMlmPage("commission")
        }
        onRules={() =>
          setMlmPage("rules")
        }
        onTree={() =>
          setMlmPage("tree")
        }
        onWallet={() =>
          setMlmPage("wallet")
        }
        onLogout={() => {
          localStorage.removeItem(
            "justbrand_mlm_member"
          );

          setMlmMember(null);
          setMlmPage("login");
        }}
      />
    );
  }

  // ==========================================
  // MLM COMMISSION
  // ==========================================

  if (mlmPage === "commission") {
    return (
      <MLMCommission
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM RULES
  // ==========================================

  if (mlmPage === "rules") {
    return (
      <MLMCommissionRules
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM TREE
  // ==========================================

  if (mlmPage === "tree") {
    return (
      <MLMTree
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM WALLET
  // ==========================================

  if (mlmPage === "wallet") {
    return (
      <MLMWallet
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // PRODUCT DETAILS
  // ==========================================

  if (selectedProduct) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() =>
            setShowCart(true)
          }
        />

        <ProductDetails
          product={selectedProduct}
          onBack={() =>
            setSelectedProduct(null)
          }
          addToCart={addToCart}
        />
      </>
    );
  }

  // ==========================================
  // CART
  // ==========================================

  if (showCart) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() => {}}
        />

        <Cart
          cart={cart}
          onBack={() =>
            setShowCart(false)
          }
          removeFromCart={removeFromCart}
          updateQuantity={updateQuantity}
        />
      </>
    );
  }

  // ==========================================
  // COMPARE
  // ==========================================

  if (showCompare) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() =>
            setShowCart(true)
          }
        />

        <ComparePrice
          products={compareProducts}
          selectedProduct={
            compareSelectedProduct
          }
          onBack={() => {
            setShowCompare(false);
          }}
          onRemove={removeCompare}
        />
      </>
    );
  }

  // ==========================================
  // MAIN BUYER PAGE
  // ==========================================

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#f5f5f5",
        overflowX: "hidden",
      }}
    >
      {/* ======================================
          HEADER
      ====================================== */}

      <Header
        {...commonHeaderProps}
        onCart={() =>
          setShowCart(true)
        }
      />

      {/* ======================================
          MLM MEMBER BUTTON
      ====================================== */}

      <div
        style={{
          width: "100%",
          background: "#fff",
          padding: "10px 20px",
          boxSizing: "border-box",
          borderBottom:
            "1px solid #eee",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            justifyContent:
              "flex-end",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          {mlmMember ? (
            <>
              <button
                onClick={() =>
                  setMlmPage("dashboard")
                }
                style={
                  mlmButtonStyle
                }
              >
                👤 My MLM Dashboard
              </button>

              <button
                onClick={() =>
                  setMlmPage("wallet")
                }
                style={
                  mlmWalletButtonStyle
                }
              >
                💰 Commission Wallet
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  setMlmPage("login")
                }
                style={
                  mlmButtonStyle
                }
              >
                🔐 MLM Login
              </button>

              <button
                onClick={() =>
                  setMlmPage("register")
                }
                style={
                  mlmRegisterButtonStyle
                }
              >
                📝 Join JustBrand
              </button>
            </>
          )}
        </div>
      </div>

      {/* ======================================
          BANNER
      ====================================== */}

      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          height: "220px",
          margin: "15px auto",
          padding: "0 10px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(135deg,#ff6b00,#ff1493)",
            borderRadius: "15px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "25px",
            fontWeight: "bold",
            textAlign: "center",
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          Shop & Earn with JustBrand
        </div>
      </div>

      {/* ======================================
          CATEGORY BAR
      ====================================== */}

      <div
        style={{
          width: "100%",
          background: "white",
          padding: "15px",
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          borderBottom:
            "1px solid #ddd",
          boxSizing: "border-box",
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
              cursor: "pointer",
              whiteSpace:
                "nowrap",
              flexShrink: 0,
            }}
          >
            {item}
          </button>
        ))}
      </div>

      {/* ======================================
          MAIN CONTENT
      ====================================== */}

      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "20px",
          boxSizing: "border-box",
        }}
      >
        {/* ====================================
            COMPARE SLIDER
        ==================================== */}

        {!loading &&
          products.length > 0 && (
            <div
              style={{
                marginBottom:
                  "30px",
              }}
            >
              <ComparePriceSlider
                products={products}
                onCompare={
                  compareSingleProduct
                }
              />
            </div>
          )}

        {/* ====================================
            TITLE
        ==================================== */}

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom:
              "20px",
          }}
        >
          <div>
            <h2
              style={{
                margin:
                  "0 0 5px",
              }}
            >
              JustBrand Products
            </h2>

            <p
              style={{
                color: "#666",
                margin: 0,
              }}
            >
              Best products at best prices
            </p>
          </div>

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
              {compareProducts.length}
              )
            </button>
          )}
        </div>

        {/* ====================================
            LOADING
        ==================================== */}

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
            }}
          >
            <h3>
              Loading products...
            </h3>
          </div>
        )}

        {/* ====================================
            PRODUCTS
        ==================================== */}

        {!loading &&
          filteredProducts.length >
            0 && (
            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(220px,1fr))",
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

        {/* ====================================
            NO PRODUCTS
        ==================================== */}

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
      </div>
    </div>
  );
}

// ==========================================
// MLM BUTTON STYLES
// ==========================================

const mlmButtonStyle = {
  background:
    "linear-gradient(135deg,#ff6b00,#ff1493)",
  color: "#fff",
  border: "none",
  padding: "10px 16px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: "bold",
};

const mlmRegisterButtonStyle = {
  background: "#fff",
  color: "#ff1493",
  border: "1px solid #ff1493",
  padding: "10px 16px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: "bold",
};

const mlmWalletButtonStyle = {
  background: "#fff7e8",
  color: "#ff6b00",
  border: "1px solid #ffb347",
  padding: "10px 16px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: "bold",
};

// ==========================================
// EXPORT
// ==========================================

export default App;


import React, { useEffect, useState } from "react";
import EditProduct from "../components/EditProduct";

const API_URL = "http://localhost:5000";

function MyProducts({ onBack, onAddProduct }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [editingProduct, setEditingProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  // ==========================================
  // GET CURRENT SELLER
  // ==========================================

  function getCurrentSeller() {
    const sellerId =
      localStorage.getItem("sellerId") ||
      localStorage.getItem("seller_id") ||
      "";

    const sellerName =
      localStorage.getItem("sellerName") ||
      localStorage.getItem("seller_name") ||
      "";

    return {
      sellerId: String(sellerId).trim(),
      sellerName: String(sellerName).trim(),
    };
  }

  // ==========================================
  // LOAD PRODUCTS
  // ==========================================

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);

    const seller = getCurrentSeller();

    try {
      // ----------------------------------------
      // 1. LOAD BACKEND PRODUCTS
      // ----------------------------------------

      const response = await fetch(
        `${API_URL}/api/admin/products`
      );

      if (!response.ok) {
        throw new Error("Backend products loading failed.");
      }

      const data = await response.json();

      let backendProducts = [];

      if (Array.isArray(data)) {
        backendProducts = data;
      } else if (Array.isArray(data.products)) {
        backendProducts = data.products;
      } else if (Array.isArray(data.results)) {
        backendProducts = data.results;
      }

      // ----------------------------------------
      // 2. ONLY CURRENT SELLER PRODUCTS
      // ----------------------------------------

      const sellerProducts = backendProducts.filter(
        (product) => {
          const productSellerId = String(
            product.sellerId ||
              product.seller_id ||
              ""
          ).trim();

          const productSellerName = String(
            product.sellerName ||
              product.seller_name ||
              ""
          ).trim();

          // Best match: seller ID
          if (
            seller.sellerId &&
            productSellerId
          ) {
            return (
              productSellerId ===
              seller.sellerId
            );
          }

          // Fallback: seller name
          if (
            seller.sellerName &&
            productSellerName
          ) {
            return (
              productSellerName.toLowerCase() ===
              seller.sellerName.toLowerCase()
            );
          }

          return false;
        }
      );

      // ----------------------------------------
      // 3. LOAD OLD LOCAL PRODUCTS
      // ----------------------------------------

      let localProducts = [];

      try {
        const saved = localStorage.getItem(
          "justbrand_seller_products"
        );

        if (saved) {
          const parsed = JSON.parse(saved);

          if (Array.isArray(parsed)) {
            localProducts = parsed;
          }
        }
      } catch (error) {
        console.error(
          "Local products loading error:",
          error
        );
      }

      // ----------------------------------------
      // 4. MERGE BACKEND + LOCAL PRODUCTS
      // ----------------------------------------

      const mergedMap = new Map();

      // Backend products first
      sellerProducts.forEach((product) => {
        const key =
          product.id !== undefined &&
          product.id !== null
            ? String(product.id)
            : `${product.name}-${product.price}`;

        mergedMap.set(key, product);
      });

      // Local products
      localProducts.forEach((product) => {
        const productSellerId = String(
          product.sellerId ||
            product.seller_id ||
            ""
        ).trim();

        const productSellerName = String(
          product.sellerName ||
            product.seller_name ||
            ""
        ).trim();

        // Keep local product only if it belongs
        // to current seller.
        const belongsToSeller =
          !productSellerId &&
          !productSellerName
            ? true
            : (
                seller.sellerId &&
                productSellerId &&
                productSellerId ===
                  seller.sellerId
              ) ||
              (
                seller.sellerName &&
                productSellerName &&
                productSellerName.toLowerCase() ===
                  seller.sellerName.toLowerCase()
              );

        if (!belongsToSeller) {
          return;
        }

        const key =
          product.id !== undefined &&
          product.id !== null
            ? String(product.id)
            : `${product.name}-${product.price}`;

        if (!mergedMap.has(key)) {
          mergedMap.set(key, product);
        }
      });

      const finalProducts = Array.from(
        mergedMap.values()
      );

      setProducts(finalProducts);
    } catch (error) {
      console.error(
        "Backend products loading error:",
        error
      );

      // ----------------------------------------
      // FALLBACK TO LOCALSTORAGE
      // ----------------------------------------

      try {
        const saved = localStorage.getItem(
          "justbrand_seller_products"
        );

        if (saved) {
          const data = JSON.parse(saved);

          setProducts(
            Array.isArray(data)
              ? data
              : []
          );
        } else {
          setProducts([]);
        }
      } catch (localError) {
        console.error(
          "Products loading error:",
          localError
        );

        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // DELETE PRODUCT
  // ==========================================

  async function deleteProduct(id) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this product?"
    );

    if (!confirmDelete) {
      return;
    }

    try {
      const token =
        localStorage.getItem("token") ||
        localStorage.getItem("authToken") ||
        "";

      const response = await fetch(
        `${API_URL}/api/products/${id}`,
        {
          method: "DELETE",
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {},
        }
      );

      if (!response.ok) {
        console.warn(
          "Backend delete failed or permission denied."
        );
      }
    } catch (error) {
      console.error(
        "Backend delete error:",
        error
      );
    }

    // Remove from screen
    const updatedProducts =
      products.filter(
        (product) =>
          String(product.id) !==
          String(id)
      );

    setProducts(updatedProducts);

    // Update local storage
    try {
      localStorage.setItem(
        "justbrand_seller_products",
        JSON.stringify(updatedProducts)
      );
    } catch (error) {
      console.error(
        "Local product delete error:",
        error
      );
    }

    // Remove from Buyer local products
    try {
      const buyerSaved =
        localStorage.getItem(
          "justbrand_products"
        );

      if (buyerSaved) {
        const buyerProducts =
          JSON.parse(buyerSaved);

        if (Array.isArray(buyerProducts)) {
          const updatedBuyerProducts =
            buyerProducts.filter(
              (product) =>
                String(product.id) !==
                String(id)
            );

          localStorage.setItem(
            "justbrand_products",
            JSON.stringify(
              updatedBuyerProducts
            )
          );
        }
      }
    } catch (error) {
      console.error(
        "Buyer product delete error:",
        error
      );
    }

    alert(
      "Product deleted successfully."
    );
  }

  // ==========================================
  // SEARCH
  // ==========================================

  const searchText =
    search.toLowerCase().trim();

  const filteredProducts =
    products.filter((product) => {
      const name = String(
        product.name || ""
      ).toLowerCase();

      const category = String(
        product.category || ""
      ).toLowerCase();

      const sku = String(
        product.sku || ""
      ).toLowerCase();

      const brand = String(
        product.brand || ""
      ).toLowerCase();

      return (
        name.includes(searchText) ||
        category.includes(searchText) ||
        sku.includes(searchText) ||
        brand.includes(searchText)
      );
    });

  // ==========================================
  // EDIT SCREEN
  // ==========================================

  if (editingProduct) {
    return (
      <EditProduct
        product={editingProduct}
        onBack={() =>
          setEditingProduct(null)
        }
        onSaved={(updatedProduct) => {
          setProducts((prev) =>
            prev.map((item) =>
              String(item.id) ===
              String(updatedProduct.id)
                ? updatedProduct
                : item
            )
          );

          setEditingProduct(null);
        }}
      />
    );
  }

  // ==========================================
  // SUMMARY COUNTS
  // ==========================================

  const totalProducts =
    products.length;

  const pendingProducts =
    products.filter(
      (product) =>
        String(
          product.status || "Pending"
        ).toLowerCase() === "pending"
    ).length;

  const approvedProducts =
    products.filter(
      (product) =>
        String(
          product.status || ""
        ).toLowerCase() === "approved"
    ).length;

  const lowStockProducts =
    products.filter(
      (product) =>
        Number(product.stock || 0) <= 5
    ).length;

  // ==========================================
  // MAIN UI
  // ==========================================

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        color: "#222",
      }}
    >
      {/* =====================================
          HEADER
      ===================================== */}

      <header
        style={{
          background:
            "linear-gradient(135deg,#ff6b00,#ff1493)",
          color: "white",
          padding: "15px 25px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "15px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "bold",
            }}
          >
            JustBrand
          </div>

          <div
            style={{
              fontSize: "13px",
              opacity: 0.9,
            }}
          >
            Seller Panel
          </div>
        </div>

        <button
          onClick={onBack}
          style={{
            border: "none",
            background: "white",
            color: "#ff1493",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← Dashboard
        </button>
      </header>

      {/* =====================================
          MAIN
      ===================================== */}

      <main
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "25px",
          boxSizing: "border-box",
        }}
      >
        {/* ===================================
            TITLE
        =================================== */}

        <div
          style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent:
              "space-between",
            gap: "15px",
            flexWrap: "wrap",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "26px",
              }}
            >
              📦 My Products
            </h1>

            <p
              style={{
                margin: "6px 0 0",
                color: "#777",
              }}
            >
              Manage your JustBrand products
            </p>
          </div>

          <button
            onClick={onAddProduct}
            style={{
              background: "#ff6b00",
              color: "white",
              border: "none",
              padding: "11px 18px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ➕ Add Product
          </button>
        </div>

        {/* ===================================
            SEARCH
        =================================== */}

        <div
          style={{
            background: "white",
            padding: "15px",
            borderRadius: "12px",
            marginTop: "20px",
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="🔎 Search product, category, brand or SKU..."
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              fontSize: "15px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* ===================================
            SUMMARY
        =================================== */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(180px,1fr))",
            gap: "15px",
            marginTop: "20px",
          }}
        >
          <SummaryCard
            title="Total Products"
            value={totalProducts}
            icon="📦"
          />

          <SummaryCard
            title="Pending"
            value={pendingProducts}
            icon="🕐"
          />

          <SummaryCard
            title="Approved"
            value={approvedProducts}
            icon="✅"
          />

          <SummaryCard
            title="Low Stock"
            value={lowStockProducts}
            icon="⚠️"
          />
        </div>

        {/* ===================================
            PRODUCTS
        =================================== */}

        <div
          style={{
            marginTop: "25px",
          }}
        >
          {loading ? (
            <div
              style={{
                background: "white",
                borderRadius: "12px",
                padding: "50px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "45px",
                }}
              >
                ⏳
              </div>

              <h2>
                Loading Products...
              </h2>

              <p
                style={{
                  color: "#777",
                }}
              >
                Please wait.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div
              style={{
                background: "white",
                borderRadius: "12px",
                padding: "50px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "55px",
                }}
              >
                📦
              </div>

              <h2>
                No Products Found
              </h2>

              <p
                style={{
                  color: "#777",
                }}
              >
                {products.length === 0
                  ? "You have not added any products yet."
                  : "Try another search."}
              </p>

              {products.length === 0 && (
                <button
                  onClick={onAddProduct}
                  style={{
                    background: "#ff6b00",
                    color: "white",
                    border: "none",
                    padding: "11px 20px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  ➕ Add Your First Product
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(260px,1fr))",
                gap: "20px",
              }}
            >
              {filteredProducts.map(
                (product) => (
                  <ProductItem
                    key={product.id}
                    product={product}
                    onEdit={() =>
                      setEditingProduct(
                        product
                      )
                    }
                    onDelete={() =>
                      deleteProduct(
                        product.id
                      )
                    }
                  />
                )
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ==========================================
   PRODUCT ITEM
========================================== */

function ProductItem({
  product,
  onEdit,
  onDelete,
}) {
  const statusStyle =
    getStatusStyle(
      product.status
    );

  const stock = Number(
    product.stock || 0
  );

  const lowStock = stock <= 5;

  return (
    <div
      style={{
        background: "white",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow:
          "0 2px 10px rgba(0,0,0,0.08)",
      }}
    >
      {/* IMAGE */}

      <div
        style={{
          height: "210px",
          background: "#f7f7f7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={
            product.image ||
            "/images/product1.png"
          }
          alt={
            product.name ||
            "Product"
          }
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

      {/* CONTENT */}

      <div
        style={{
          padding: "16px",
        }}
      >
        {/* CATEGORY + STATUS */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent:
              "space-between",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              color: "#777",
            }}
          >
            {product.category ||
              "Other"}
          </span>

          <span
            style={{
              ...statusStyle,
              padding: "5px 9px",
              borderRadius: "20px",
              fontSize: "11px",
              fontWeight: "bold",
            }}
          >
            {product.status ||
              "Pending"}
          </span>
        </div>

        {/* NAME */}

        <h3
          style={{
            margin: "10px 0 6px",
            fontSize: "17px",
          }}
        >
          {product.name ||
            "Product"}
        </h3>

        {/* PRICE */}

        <div
          style={{
            color: "#ff6b00",
            fontWeight: "bold",
            fontSize: "20px",
          }}
        >
          {product.price ||
            "₹0"}
        </div>

        {/* MRP */}

        {product.mrp && (
          <div
            style={{
              color: "#999",
              fontSize: "13px",
              marginTop: "3px",
              textDecoration:
                "line-through",
            }}
          >
            MRP: {product.mrp}
          </div>
        )}

        {/* STOCK + SKU */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "1fr 1fr",
            gap: "8px",
            marginTop: "15px",
          }}
        >
          <div
            style={{
              background: lowStock
                ? "#fff3cd"
                : "#f5f5f5",
              color: lowStock
                ? "#856404"
                : "#222",
              padding: "9px",
              borderRadius: "7px",
              fontSize: "13px",
            }}
          >
            <strong>
              Stock
            </strong>

            <br />

            {stock}

            {lowStock && (
              <span
                style={{
                  display: "block",
                  fontSize: "11px",
                  marginTop: "3px",
                  fontWeight: "bold",
                }}
              >
                ⚠️ Low Stock
              </span>
            )}
          </div>

          <div
            style={{
              background: "#f5f5f5",
              padding: "9px",
              borderRadius: "7px",
              fontSize: "13px",
            }}
          >
            <strong>
              SKU
            </strong>

            <br />

            {product.sku || "-"}
          </div>
        </div>

        {/* BUTTONS */}

        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "15px",
          }}
        >
          <button
            onClick={onEdit}
            style={{
              flex: 1,
              padding: "9px",
              border: "1px solid #ccc",
              background: "white",
              borderRadius: "7px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ✏️ Edit
          </button>

          <button
            onClick={onDelete}
            style={{
              flex: 1,
              padding: "9px",
              border: "none",
              background: "#dc3545",
              color: "white",
              borderRadius: "7px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   SUMMARY CARD
========================================== */

function SummaryCard({
  title,
  value,
  icon,
}) {
  return (
    <div
      style={{
        background: "white",
        padding: "18px",
        borderRadius: "12px",
        boxShadow:
          "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontSize: "25px",
        }}
      >
        {icon}
      </div>

      <div
        style={{
          color: "#777",
          fontSize: "13px",
          marginTop: "5px",
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: "24px",
          fontWeight: "bold",
          marginTop: "3px",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ==========================================
   STATUS STYLE
========================================== */

function getStatusStyle(status) {
  const currentStatus =
    String(
      status || "Pending"
    ).toLowerCase();

  if (
    currentStatus === "approved"
  ) {
    return {
      background: "#d4edda",
      color: "#155724",
    };
  }

  if (
    currentStatus === "rejected"
  ) {
    return {
      background: "#f8d7da",
      color: "#721c24",
    };
  }

  return {
    background: "#fff3cd",
    color: "#856404",
  };
}

export default MyProducts;

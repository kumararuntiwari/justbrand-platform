import React, { useState } from "react";

const STORAGE_KEY = "justbrand_products";
const BACKEND_URL = "http://localhost:5000/api/products";

function App() {
  // =========================
  // PRODUCTS
  // =========================

  const [products, setProducts] = useState(() => {
    try {
      const savedProducts =
        localStorage.getItem(STORAGE_KEY);

      return savedProducts
        ? JSON.parse(savedProducts)
        : [];
    } catch (error) {
      return [];
    }
  });

  // =========================
  // PRODUCT FORM
  // =========================

  const [product, setProduct] = useState({
    name: "",
    shortDetails: "",
    category: "",
    price: "",
    oldPrice: "",
    stock: "",
    image: "",
  });

  // =========================
  // EDIT MODE
  // =========================

  const [editingId, setEditingId] =
    useState(null);

  // =========================
  // FORM CHANGE
  // =========================

  const handleChange = (e) => {
    const { name, value } = e.target;

    setProduct((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // =========================
  // RESET FORM
  // =========================

  const resetForm = () => {
    setProduct({
      name: "",
      shortDetails: "",
      category: "",
      price: "",
      oldPrice: "",
      stock: "",
      image: "",
    });

    setEditingId(null);
  };

  // =========================
  // ADD / UPDATE PRODUCT
  // =========================

  const saveProduct = async (e) => {
    e.preventDefault();

    // Required fields
    if (
      !product.name ||
      !product.price ||
      !product.category
    ) {
      alert(
        "Please fill Product Name, Price and Category"
      );
      return;
    }

    // =========================
    // UPDATE EXISTING PRODUCT
    // =========================

    if (editingId !== null) {
      const updatedProduct = {
        ...product,
        id: editingId,
        sellerProduct: true,
      };

      const updatedProducts =
        products.map((item) =>
          item.id === editingId
            ? updatedProduct
            : item
        );

      // LocalStorage
      setProducts(updatedProducts);

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(updatedProducts)
      );

      // Backend
      try {
        const response = await fetch(
          `${BACKEND_URL}/${editingId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              updatedProduct
            ),
          }
        );

        if (!response.ok) {
          throw new Error(
            "Backend update failed"
          );
        }

        const data =
          await response.json();

        console.log(
          "Product updated:",
          data
        );
      } catch (error) {
        console.error(
          "Backend update error:",
          error
        );
      }

      alert(
        "Product updated successfully!"
      );

      resetForm();

      return;
    }

    // =========================
    // ADD NEW PRODUCT
    // =========================

    const newProduct = {
      ...product,
      id: Date.now(),
      sellerProduct: true,
    };

    // LocalStorage
    const updatedProducts = [
      ...products,
      newProduct,
    ];

    setProducts(updatedProducts);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(updatedProducts)
    );

    // Backend
    try {
      const response = await fetch(
        BACKEND_URL,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify(
            newProduct
          ),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Backend save failed"
        );
      }

      const data =
        await response.json();

      console.log(
        "Product saved to backend:",
        data
      );
    } catch (error) {
      console.error(
        "Backend connection error:",
        error
      );
    }

    alert(
      "Product added successfully!"
    );

    resetForm();
  };

  // =========================
  // EDIT PRODUCT
  // =========================

  const editProduct = (item) => {
    setProduct({
      name: item.name || "",
      shortDetails:
        item.shortDetails || "",
      category: item.category || "",
      price: item.price || "",
      oldPrice: item.oldPrice || "",
      stock: item.stock || "",
      image: item.image || "",
    });

    setEditingId(item.id);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // =========================
  // DELETE PRODUCT
  // =========================

  const deleteProduct = async (id) => {
    const confirmDelete =
      window.confirm(
        "Are you sure you want to delete this product?"
      );

    if (!confirmDelete) {
      return;
    }

    const updatedProducts =
      products.filter(
        (item) => item.id !== id
      );

    setProducts(updatedProducts);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(updatedProducts)
    );

    // Backend Delete
    try {
      const response = await fetch(
        `${BACKEND_URL}/${id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Backend delete failed"
        );
      }

      console.log(
        "Product deleted from backend"
      );
    } catch (error) {
      console.error(
        "Delete backend error:",
        error
      );
    }

    // If deleted product was being edited
    if (editingId === id) {
      resetForm();
    }

    alert(
      "Product deleted successfully!"
    );
  };

  // =========================
  // IMAGE URL
  // =========================

  const getImageUrl = (image) => {
    if (!image) {
      return "";
    }

    // Full URL
    if (
      image.startsWith("http://") ||
      image.startsWith("https://")
    ) {
      return image;
    }

    // Already starts with /
    if (image.startsWith("/")) {
      return image;
    }

    return `/${image}`;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        padding: "20px",
        fontFamily:
          "Arial, sans-serif",
      }}
    >
      {/* ========================= */}
      {/* HEADER */}
      {/* ========================= */}

      <div
        style={{
          background:
            "linear-gradient(90deg, #ff6b00, #ff1493)",
          color: "white",
          padding: "20px",
          borderRadius: "12px",
          marginBottom: "25px",
        }}
      >
        <h1
          style={{
            margin: 0,
          }}
        >
          JustBrand Seller Panel
        </h1>

        <p
          style={{
            marginBottom: 0,
          }}
        >
          Add and manage your products
        </p>
      </div>

      {/* ========================= */}
      {/* PRODUCT FORM */}
      {/* ========================= */}

      <div
        style={{
          background: "white",
          padding: "25px",
          borderRadius: "12px",
          maxWidth: "700px",
          margin: "auto",
          boxShadow:
            "0 2px 8px #ddd",
        }}
      >
        <h2>
          {editingId !== null
            ? "✏️ Edit Product"
            : "➕ Add New Product"}
        </h2>

        <form onSubmit={saveProduct}>
          {/* PRODUCT NAME */}

          <label>
            Product Name
          </label>

          <input
            type="text"
            name="name"
            value={product.name}
            onChange={handleChange}
            placeholder="Enter product name"
            style={inputStyle}
          />

          {/* SHORT DETAILS */}

          <label>
            Short Details
          </label>

          <textarea
            name="shortDetails"
            value={
              product.shortDetails
            }
            onChange={handleChange}
            placeholder="Enter short product details"
            style={{
              ...inputStyle,
              height: "80px",
              resize: "vertical",
            }}
          />

          {/* CATEGORY */}

          <label>
            Category
          </label>

          <select
            name="category"
            value={product.category}
            onChange={handleChange}
            style={inputStyle}
          >
            <option value="">
              Select Category
            </option>

            <option value="Electronics">
              Electronics
            </option>

            <option value="Fashion">
              Fashion
            </option>

            <option value="Beauty">
              Beauty
            </option>

            <option value="Home">
              Home & Kitchen
            </option>

            <option value="Grocery">
              Grocery
            </option>
          </select>

          {/* PRICE */}

          <label>
            Selling Price
          </label>

          <input
            type="number"
            name="price"
            value={product.price}
            onChange={handleChange}
            placeholder="₹ Selling Price"
            style={inputStyle}
          />

          {/* OLD PRICE */}

          <label>
            MRP / Old Price
          </label>

          <input
            type="number"
            name="oldPrice"
            value={product.oldPrice}
            onChange={handleChange}
            placeholder="₹ MRP"
            style={inputStyle}
          />

          {/* STOCK */}

          <label>
            Stock Quantity
          </label>

          <input
            type="number"
            name="stock"
            value={product.stock}
            onChange={handleChange}
            placeholder="Available quantity"
            style={inputStyle}
          />

          {/* IMAGE */}

          <label>
            Product Image URL
          </label>

          <input
            type="text"
            name="image"
            value={product.image}
            onChange={handleChange}
            placeholder="/image/newbude.jpg.png"
            style={inputStyle}
          />

          <p
            style={{
              fontSize: "13px",
              color: "#777",
              marginTop: "-8px",
            }}
          >
            Example:
            /image/newbude.jpg.png
          </p>

          {/* IMAGE PREVIEW */}

          {product.image && (
            <div
              style={{
                marginBottom: "15px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  marginBottom: "8px",
                  fontWeight: "bold",
                }}
              >
                Image Preview
              </p>

              <img
                src={getImageUrl(
                  product.image
                )}
                alt="Product Preview"
                onError={(e) => {
                  e.currentTarget.style.display =
                    "none";
                }}
                style={{
                  width: "180px",
                  height: "150px",
                  objectFit: "contain",
                  background:
                    "#f5f5f5",
                  borderRadius: "8px",
                }}
              />
            </div>
          )}

          {/* BUTTONS */}

          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "15px",
            }}
          >
            {/* SAVE */}

            <button
              type="submit"
              style={{
                flex: 1,
                background:
                  editingId !== null
                    ? "#28a745"
                    : "#ff6b00",
                color: "white",
                border: "none",
                padding: "14px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "18px",
                fontWeight: "bold",
              }}
            >
              {editingId !== null
                ? "💾 Update Product"
                : "➕ Add Product"}
            </button>

            {/* CANCEL EDIT */}

            {editingId !== null && (
              <button
                type="button"
                onClick={resetForm}
                style={{
                  background:
                    "#777",
                  color: "white",
                  border: "none",
                  padding:
                    "14px 20px",
                  borderRadius:
                    "8px",
                  cursor: "pointer",
                  fontSize:
                    "16px",
                  fontWeight:
                    "bold",
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ========================= */}
      {/* LISTED PRODUCTS */}
      {/* ========================= */}

      <div
        style={{
          maxWidth: "1100px",
          margin: "30px auto",
        }}
      >
        <h2>
          My Listed Products (
          {products.length})
        </h2>

        {products.length === 0 ? (
          <div
            style={{
              background: "white",
              padding: "30px",
              borderRadius:
                "12px",
              textAlign: "center",
            }}
          >
            No products listed yet.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "20px",
            }}
          >
            {products.map((item) => (
              <div
                key={item.id}
                style={{
                  background:
                    "white",
                  padding: "15px",
                  borderRadius:
                    "12px",
                  boxShadow:
                    "0 2px 8px #ddd",
                }}
              >
                {/* IMAGE */}

                {item.image ? (
                  <img
                    src={getImageUrl(
                      item.image
                    )}
                    alt={item.name}
                    onError={(e) => {
                      e.currentTarget.style.display =
                        "none";
                    }}
                    style={{
                      width: "100%",
                      height: "180px",
                      objectFit:
                        "contain",
                      background:
                        "#f5f5f5",
                      borderRadius:
                        "8px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "180px",
                      background:
                        "#f5f5f5",
                      borderRadius:
                        "8px",
                      display: "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                      color: "#999",
                    }}
                  >
                    No Image
                  </div>
                )}

                {/* SELLER LABEL */}

                <div
                  style={{
                    display:
                      "inline-block",
                    marginTop:
                      "10px",
                    padding:
                      "4px 8px",
                    borderRadius:
                      "5px",
                    background:
                      "#ffe5d0",
                    color:
                      "#ff6b00",
                    fontSize:
                      "12px",
                    fontWeight:
                      "bold",
                  }}
                >
                  Seller Product
                </div>

                {/* NAME */}

                <h3>
                  {item.name}
                </h3>

                {/* DETAILS */}

                <p
                  style={{
                    color: "#555",
                  }}
                >
                  {item.shortDetails}
                </p>

                {/* CATEGORY */}

                <p>
                  Category:{" "}
                  {item.category}
                </p>

                {/* PRICE */}

                <strong
                  style={{
                    color:
                      "#ff6b00",
                    fontSize:
                      "20px",
                  }}
                >
                  ₹{item.price}
                </strong>

                {/* OLD PRICE */}

                {item.oldPrice && (
                  <span
                    style={{
                      marginLeft:
                        "8px",
                      textDecoration:
                        "line-through",
                      color:
                        "#888",
                    }}
                  >
                    ₹
                    {
                      item.oldPrice
                    }
                  </span>
                )}

                {/* STOCK */}

                <p>
                  Stock:{" "}
                  {item.stock}
                </p>

                {/* BUTTONS */}

                <div
                  style={{
                    display:
                      "flex",
                    gap: "8px",
                    marginTop:
                      "10px",
                  }}
                >
                  {/* EDIT */}

                  <button
                    onClick={() =>
                      editProduct(
                        item
                      )
                    }
                    style={{
                      flex: 1,
                      background:
                        "#1976d2",
                      color:
                        "white",
                      border:
                        "none",
                      padding:
                        "10px",
                      borderRadius:
                        "7px",
                      cursor:
                        "pointer",
                      fontWeight:
                        "bold",
                    }}
                  >
                    ✏️ Edit
                  </button>

                  {/* DELETE */}

                  <button
                    onClick={() =>
                      deleteProduct(
                        item.id
                      )
                    }
                    style={{
                      flex: 1,
                      background:
                        "#e53935",
                      color:
                        "white",
                      border:
                        "none",
                      padding:
                        "10px",
                      borderRadius:
                        "7px",
                      cursor:
                        "pointer",
                      fontWeight:
                        "bold",
                    }}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================
// INPUT STYLE
// =========================

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px",
  marginTop: "6px",
  marginBottom: "15px",
  border: "1px solid #ddd",
  borderRadius: "7px",
  fontSize: "15px",
};

export default App;
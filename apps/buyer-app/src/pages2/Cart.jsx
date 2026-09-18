import React, { useState } from "react";

// =====================================================
// JUSTBRAND BUYER CART
// =====================================================
// Uses the cart handlers passed down from App.jsx:
//   removeFromCart(id), updateQuantity(id, qty)
// Selection is owned by App.jsx so Checkout receives
// exactly the selected items. Prices here are display
// only — the backend revalidates every item and computes
// the final order total server-side.

function parsePrice(value) {
  return (
    Number(String(value || "0").replace(/[^0-9.]/g, "")) || 0
  );
}

function Cart({
  cart,
  onBack,
  onCheckout,
  removeFromCart,
  updateQuantity,
  onSelectProduct,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onClearCart,
}) {
  const [isMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches
  );

  const selected =
    selectedIds ||
    (() => {
      const set = new Set();
      cart.forEach((item) => set.add(String(item.id)));
      return set;
    })();

  const allSelected =
    cart.length > 0 &&
    cart.every((item) => selected.has(String(item.id)));

  const selectedItems = cart.filter((item) =>
    selected.has(String(item.id))
  );

  const subtotal = selectedItems.reduce(
    (sum, item) =>
      sum + parsePrice(item.price) * (Number(item.quantity) || 1),
    0
  );

  const totalItems = selectedItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 1),
    0
  );

  const card = {
    background: "var(--jb-card, #ffffff)",
    padding: "14px",
    borderRadius: "12px",
    marginBottom: "12px",
    display: "flex",
    alignItems: "center",
    gap: "14px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    border: "1px solid rgba(0,0,0,0.05)",
  };

  const qtyBtn = {
    width: "30px",
    height: "30px",
    borderRadius: "7px",
    border: "1px solid #ddd",
    background: "#fff",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    lineHeight: 1,
    color: "#333",
    flexShrink: 0,
  };

  return (
    <div
      className="jb-page"
      style={{
        padding: isMobile ? "14px" : "30px",
        maxWidth: "900px",
        margin: "auto",
        minHeight: "100vh",
      }}
    >
      <div className="jb-family-chakra" aria-hidden="true" />

      <button
        onClick={onBack}
        style={{
          padding: "10px 20px",
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: "8px",
          cursor: "pointer",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        ← Back
      </button>

      <h2 style={{ margin: "0 0 16px", display: "flex", alignItems: "center", gap: "8px" }}>
        🛒 My Cart
      </h2>

      {cart.length === 0 ? (
        <div
          style={{
            background: "var(--jb-card, #fff)",
            padding: "40px 20px",
            borderRadius: "12px",
            textAlign: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "10px" }}>🛒</div>
          <h3 style={{ margin: "0 0 6px" }}>Your cart is empty</h3>
          <p style={{ color: "#777", margin: 0 }}>
            Browse products and add them to your cart.
          </p>
        </div>
      ) : (
        <>
          {/* ===== SELECT ALL / CLEAR ===== */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
              background: "var(--jb-card, #fff)",
              borderRadius: "10px",
              padding: "10px 14px",
              marginBottom: "14px",
              boxShadow: "0 1px 5px rgba(0,0,0,0.07)",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "14px",
              }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleSelectAll && onToggleSelectAll()}
                style={{ width: "17px", height: "17px", cursor: "pointer" }}
              />
              Select all ({cart.length})
            </label>

            {cart.length > 0 && onClearCart && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear your entire cart? This removes all items."
                    )
                  ) {
                    onClearCart();
                  }
                }}
                style={{
                  padding: "7px 12px",
                  background: "#fff",
                  color: "#c62828",
                  border: "1px solid #f2b8b5",
                  borderRadius: "7px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                🗑 Clear cart
              </button>
            )}
          </div>

          {/* ===== ITEMS ===== */}
          {cart.map((item) => {
            const qty = Number(item.quantity) || 1;
            const price = parsePrice(item.price);
            const isSelected = selected.has(String(item.id));

            return (
              <div key={item.id} style={card}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() =>
                    onToggleSelect && onToggleSelect(String(item.id))
                  }
                  aria-label={`Select ${item.name}`}
                  style={{
                    width: "17px",
                    height: "17px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />

                <img
                  src={item.image}
                  alt={item.name}
                  onClick={() => onSelectProduct && onSelectProduct(item)}
                  style={{
                    width: "76px",
                    height: "76px",
                    objectFit: "contain",
                    borderRadius: "8px",
                    background: "#fafafa",
                    padding: "4px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3
                    onClick={() => onSelectProduct && onSelectProduct(item)}
                    style={{
                      margin: "0 0 4px",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#1a1a1a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {item.name}
                  </h3>

                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "var(--jb-saffron-deep, #e85d04)",
                    }}
                  >
                    ₹{price.toLocaleString("en-IN")}
                    {qty > 1 && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#888",
                          fontWeight: 500,
                        }}
                      >
                        {" "}
                        × {qty} = ₹
                        {(price * qty).toLocaleString("en-IN")}
                      </span>
                    )}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <button
                        onClick={() => updateQuantity(item.id, qty - 1)}
                        aria-label="Decrease quantity"
                        style={qtyBtn}
                      >
                        −
                      </button>

                      <span
                        style={{
                          minWidth: "26px",
                          textAlign: "center",
                          fontWeight: 700,
                          fontSize: "14px",
                        }}
                      >
                        {qty}
                      </span>

                      <button
                        onClick={() => updateQuantity(item.id, qty + 1)}
                        aria-label="Increase quantity"
                        style={qtyBtn}
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => removeFromCart(item.id)}
                      aria-label={`Remove ${item.name}`}
                      style={{
                        padding: "6px 10px",
                        background: "#fff",
                        color: "#c62828",
                        border: "1px solid #f2b8b5",
                        borderRadius: "7px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* ===== SUMMARY + CHECKOUT ===== */}
          <div
            style={{
              background: "var(--jb-card, #fff)",
              borderRadius: "12px",
              padding: "18px",
              marginTop: "16px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
              position: "sticky",
              bottom: isMobile ? "12px" : "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div>
                <p style={{ margin: 0, color: "#777", fontSize: "13px" }}>
                  {selectedItems.length > 0
                    ? `${selectedItems.length} item${
                        selectedItems.length > 1 ? "s" : ""
                      } selected (${totalItems} unit${totalItems > 1 ? "s" : ""})`
                    : "No items selected"}
                </p>
                <h2
                  style={{
                    margin: "4px 0 0",
                    fontSize: "20px",
                    fontWeight: 800,
                  }}
                >
                  Subtotal: ₹{subtotal.toLocaleString("en-IN")}
                </h2>
              </div>
            </div>

            <button
              onClick={
                onCheckout && selectedItems.length > 0
                  ? onCheckout
                  : undefined
              }
              disabled={selectedItems.length === 0}
              style={{
                width: "100%",
                padding: "14px 25px",
                background:
                  selectedItems.length > 0
                    ? "linear-gradient(135deg,#ff8c1a,#e85d04)"
                    : "#e0e0e0",
                color: selectedItems.length > 0 ? "white" : "#999",
                border: "none",
                borderRadius: "9px",
                cursor: selectedItems.length > 0 ? "pointer" : "not-allowed",
                fontWeight: "bold",
                fontSize: "15px",
              }}
            >
              Proceed to Checkout ({selectedItems.length})
            </button>

            {selectedItems.length === 0 && (
              <p
                style={{
                  margin: "8px 0 0",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "#999",
                }}
              >
                Select at least one item to check out. Final total is
                confirmed securely at checkout.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Cart;

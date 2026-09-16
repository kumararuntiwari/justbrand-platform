import React, { useState } from "react";
import { api } from "../api";

function Checkout({
  cart,
  customer,
  token,
  onBack,
  onOrderPlaced,
}) {
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(
    customer?.mobile ? String(customer.mobile) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState("COD");

  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [error, setError] = useState("");

  const total = cart.reduce((sum, item) => {
    const price = Number(
      String(item.price || "0").replace(/[^0-9.]/g, "")
    );
    return sum + price * (Number(item.quantity) || 1);
  }, 0);

  async function handlePlaceOrder() {
    setError("");

    if (!customer || !token) {
      alert("Please login to place an order.");
      return;
    }

    if (address.trim().length < 10) {
      alert("Please enter a complete shipping address (min 10 characters).");
      return;
    }

    if (!/^\d{10}$/.test(phone.replace(/\D/g, ""))) {
      alert("Please enter a valid 10-digit phone number.");
      return;
    }

    setPlacing(true);

    try {
      const data = await api("/api/orders", {
        method: "POST",
        token,
        body: {
          items: cart.map((item) => ({
            productId: item.id,
            quantity: Number(item.quantity) || 1,
          })),
          address: address.trim(),
          phone: phone.replace(/\D/g, ""),
          paymentMethod,
        },
      });

      if (!data.success || !data.order) {
        setError(data.message || "Failed to place order.");
        return;
      }

      setPlacedOrder(data.order);
      onOrderPlaced(data.order);
    } catch (error) {
      console.error("Checkout error:", error);
      setError(
        error.message || "Could not reach the server. Please try again."
      );
    } finally {
      setPlacing(false);
    }
  }

  // ==========================================
  // SUCCESS VIEW
  // ==========================================

  if (placedOrder) {
    return (
      <div style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.logo}>JustBrand</div>
            <div style={styles.headerText}>Order Confirmed</div>
          </div>

          <button
            type="button"
            onClick={onBack}
            style={styles.backButton}
          >
            ← Continue Shopping
          </button>
        </header>

        <main style={styles.container}>
          <div style={styles.card}>
            <div style={styles.iconCircle}>✅</div>

            <h1 style={styles.title}>Order Placed!</h1>

            <p style={styles.subtitle}>
              Order Number:{" "}
              <strong>{placedOrder.orderNumber}</strong>
            </p>

            <div style={styles.summaryBox}>
              <div style={styles.summaryRow}>
                <span>Total Amount</span>
                <strong>₹{placedOrder.totalAmount}</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Payment Method</span>
                <strong>{placedOrder.paymentMethod}</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Status</span>
                <strong>{placedOrder.status}</strong>
              </div>
            </div>

            {(placedOrder.paymentMethod === "UPI" ||
              placedOrder.paymentMethod === "BankTransfer") && (
              <div style={styles.infoBox}>
                <div style={styles.infoTitle}>
                  💳 Payment Instructions
                </div>
                <div style={styles.infoText}>
                  {placedOrder.paymentMethod === "UPI"
                    ? "Send the total amount to the JustBrand UPI ID (shared on WhatsApp after the order)."
                    : "Transfer the total amount to the JustBrand bank account (details shared on WhatsApp after the order)."}
                  {" "}Then send the payment screenshot for confirmation. Your
                  order will be processed once payment is confirmed by our
                  team.
                </div>
              </div>
            )}

            {placedOrder.paymentMethod === "COD" && (
              <div style={styles.infoBox}>
                <div style={styles.infoTitle}>📦 Cash on Delivery</div>
                <div style={styles.infoText}>
                  Pay in cash when your order is delivered. Please keep exact
                  change ready.
                </div>
              </div>
            )}

            <div style={styles.infoBox}>
              <div style={styles.infoTitle}>🚚 What's Next?</div>
              <div style={styles.infoText}>
                Track your order anytime from Account → My Orders. You will
                also be contacted on your registered mobile number.
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ==========================================
  // FORM VIEW
  // ==========================================

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>Checkout</div>
        </div>

        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.card}>
          <div style={styles.iconCircle}>🧾</div>

          <h1 style={styles.title}>Checkout</h1>

          <p style={styles.subtitle}>
            {cart.length} item{cart.length === 1 ? "" : "s"} ·{" "}
            Total ₹{total.toLocaleString("en-IN")}
          </p>

          {/* ITEM LIST */}
          <div style={styles.itemsBox}>
            {cart.map((item, index) => (
              <div key={index} style={styles.itemRow}>
                <span style={styles.itemName}>
                  {item.name} × {item.quantity || 1}
                </span>
                <span style={styles.itemPrice}>
                  ₹
                  {(
                    Number(String(item.price || "0").replace(/[^0-9.]/g, "")) *
                    (Number(item.quantity) || 1)
                  ).toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>

          {/* ADDRESS */}
          <div style={styles.field}>
            <label style={styles.label}>Shipping Address</label>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House no, street, area, city, state, pincode"
              style={styles.textarea}
            />
          </div>

          {/* PHONE */}
          <div style={styles.field}>
            <label style={styles.label}>Contact Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              maxLength="10"
              style={styles.input}
            />
          </div>

          {/* PAYMENT METHOD */}
          <div style={styles.field}>
            <label style={styles.label}>Payment Method</label>

            <div style={styles.paymentOptions}>
              {[
                {
                  value: "COD",
                  label: "💵 Cash on Delivery",
                  desc: "Pay when your order arrives",
                },
                {
                  value: "UPI",
                  label: "📲 UPI Transfer",
                  desc: "Pay via GPay / PhonePe / Paytm",
                },
                {
                  value: "BankTransfer",
                  label: "🏦 Bank Transfer",
                  desc: "NEFT / IMPS to our account",
                },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPaymentMethod(option.value)}
                  style={{
                    ...styles.paymentOption,
                    ...(paymentMethod === option.value
                      ? styles.paymentOptionActive
                      : {}),
                  }}
                >
                  <div style={styles.paymentLabel}>{option.label}</div>
                  <div style={styles.paymentDesc}>{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          <button
            type="button"
            disabled={placing}
            onClick={handlePlaceOrder}
            style={{
              ...styles.placeOrderButton,
              opacity: placing ? 0.7 : 1,
            }}
          >
            {placing
              ? "Placing Order..."
              : `✅ Place Order · ₹${total.toLocaleString("en-IN")}`}
          </button>

          <div style={styles.infoBox}>
            <div style={styles.infoTitle}>🔒 Secure Checkout</div>
            <div style={styles.infoText}>
              Prices and availability are verified on our server before the
              order is created. Your contact details are used only for this
              order.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg,#fff7f2,#fff0f7)",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  headerText: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  backButton: {
    border: "none",
    background: "#fff",
    color: "#ff1493",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  container: {
    minHeight: "calc(100vh - 70px)",
    width: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "560px",
    background: "#fff",
    borderRadius: "16px",
    padding: "30px",
    boxShadow: "0 5px 25px rgba(0,0,0,0.09)",
    boxSizing: "border-box",
  },

  iconCircle: {
    width: "65px",
    height: "65px",
    margin: "0 auto 12px",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "30px",
  },

  title: {
    margin: 0,
    textAlign: "center",
    fontSize: "26px",
  },

  subtitle: {
    margin: "6px 0 20px",
    textAlign: "center",
    color: "#777",
    fontSize: "14px",
  },

  itemsBox: {
    background: "#fafafa",
    borderRadius: "10px",
    padding: "14px",
    marginBottom: "20px",
  },

  itemRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    fontSize: "14px",
    padding: "5px 0",
  },

  itemName: {
    color: "#333",
  },

  itemPrice: {
    fontWeight: "bold",
    color: "#ff6b00",
    whiteSpace: "nowrap",
  },

  field: {
    marginBottom: "16px",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontSize: "14px",
    fontWeight: "bold",
    color: "#333",
  },

  textarea: {
    width: "100%",
    padding: "13px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
    fontFamily: "inherit",
  },

  input: {
    width: "100%",
    padding: "13px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
  },

  paymentOptions: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  paymentOption: {
    textAlign: "left",
    padding: "13px",
    border: "2px solid #eee",
    borderRadius: "10px",
    background: "#fff",
    cursor: "pointer",
  },

  paymentOptionActive: {
    borderColor: "#ff1493",
    background: "#fff0f5",
  },

  paymentLabel: {
    fontWeight: "bold",
    fontSize: "14px",
  },

  paymentDesc: {
    fontSize: "12px",
    color: "#777",
    marginTop: "3px",
  },

  errorBox: {
    padding: "12px",
    background: "#fff0f0",
    border: "1px solid #ffcccc",
    borderRadius: "8px",
    color: "#c00",
    fontSize: "13px",
    marginBottom: "15px",
  },

  placeOrderButton: {
    width: "100%",
    padding: "14px",
    border: "none",
    borderRadius: "8px",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "bold",
    marginTop: "5px",
  },

  summaryBox: {
    background: "#fafafa",
    borderRadius: "10px",
    padding: "14px",
    margin: "15px 0",
  },

  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "14px",
    padding: "5px 0",
  },

  infoBox: {
    marginTop: "15px",
    padding: "12px",
    background: "#eef7ff",
    borderRadius: "8px",
  },

  infoTitle: {
    fontWeight: "bold",
    fontSize: "13px",
    color: "#444",
  },

  infoText: {
    marginTop: "5px",
    fontSize: "12px",
    color: "#666",
    lineHeight: 1.5,
  },
};

export default Checkout;

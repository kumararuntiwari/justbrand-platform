import React, { useEffect, useState } from "react";
import { api } from "../api";

function Checkout({
  cart,
  customer,
  token,
  onBack,
  onOrderPlaced,
}) {
  // Reuse the buyer's saved default delivery address at checkout.
  // CustomerAccount persists these fields through PUT /api/customers/me.
  const [address, setAddress] = useState(customer?.address || "");
  const [city, setCity] = useState(customer?.city || "");
  const [stateName, setStateName] = useState(customer?.state || "");
  const [pincode, setPincode] = useState(customer?.pincode || "");
  const [email, setEmail] = useState(
    customer?.email ? String(customer.email) : ""
  );
  const [phone, setPhone] = useState(
    customer?.mobile ? String(customer.mobile) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api("/api/customers/addresses", { token })
      .then((data) => {
        if (cancelled || !data?.success) return;
        const list = data.addresses || [];
        setSavedAddresses(list);
        const preferred = list.find((item) => item.isDefault);
        if (preferred) {
          setSelectedAddressId(String(preferred.id));
          setAddress(preferred.address || "");
          setCity(preferred.city || "");
          setStateName(preferred.state || "");
          setPincode(preferred.pincode || "");
          if (preferred.mobile) setPhone(preferred.mobile);
        }
      })
      .catch(() => {
        // Keep the legacy saved profile address as a fallback.
      });
    return () => { cancelled = true; };
  }, [token]);

  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [error, setError] = useState("");

  // Backend quote: THE authoritative breakdown (delivery, platform fee,
  // GST breakup) from the same calculator the order endpoint uses, so
  // the amount shown here always equals the amount the server charges.
  // DISPLAY-ONLY (final-price-only UI): the customer summary shows ONLY
  // product price, discount on MRP and the payable Total. The delivery,
  // platform and GST rows are hidden — the grand total still includes
  // them. The quote itself (and every calculation) is untouched.
  const [quote, setQuote] = useState(null);
  const [courierCheck, setCourierCheck] = useState(null);
  const [courierChecking, setCourierChecking] = useState(false);

  // Final customer price of one unit — exactly what the product card /
  // PDP displayed (customerPrice), never the raw seller price.
  const itemFinalPrice = (item) => {
    const raw =
      item.customerPrice !== undefined &&
      item.customerPrice !== null &&
      item.customerPrice !== ""
        ? item.customerPrice
        : item.price;
    return Number(String(raw || "0").replace(/[^0-9.]/g, "")) || 0;
  };

  const total = cart.reduce(
    (sum, item) =>
      sum + itemFinalPrice(item) * (Number(item.quantity) || 1),
    0
  );

  useEffect(() => {
    if (!token || !cart.length) {
      setQuote(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api("/api/orders/quote", {
          method: "POST",
          token,
          body: {
            items: cart.map((item) => ({
              productId: item.id,
              quantity: Number(item.quantity) || 1,
            })),
            state: stateName,
            deliveryMethod: "Standard",
          },
        });

        if (!cancelled && data.success && data.quote) {
          setQuote(data.quote);
        }
      } catch {
        // Quote unavailable (older backend / offline): fall back to the
        // local item total; the server still computes its own total.
        if (!cancelled) setQuote(null);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, cart, stateName]);

  const displayTotal = quote ? quote.grandTotal : total;

  // Logistics serviceability is ADDITIVE: it never changes the
  // authoritative JustBrand order total, GST, payment or commission.
  // No courier is contacted unless the admin has enabled live mode.
  useEffect(() => {
    if (!/^\d{6}$/.test(pincode) || !cart.length) {
      setCourierCheck(null);
      setCourierChecking(false);
      return undefined;
    }

    let cancelled = false;
    setCourierChecking(true);
    const timer = setTimeout(async () => {
      try {
        const estimatedWeight = Math.max(
          0.5,
          cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0) * 0.5
        );
        const data = await api("/api/courier/serviceability", {
          method: "POST",
          body: {
            pincode,
            city: city.trim(),
            state: stateName.trim(),
            weightKg: estimatedWeight,
            cod: paymentMethod === "COD",
            declaredValue: total,
          },
        });
        if (!cancelled) setCourierCheck(data);
      } catch {
        if (!cancelled) {
          setCourierCheck({
            success: false,
            serviceable: false,
            message: "Courier serviceability could not be checked right now.",
          });
        }
      } finally {
        if (!cancelled) setCourierChecking(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pincode, city, stateName, paymentMethod, cart, total]);

  // Products whose GST classification still needs admin review must not
  // be ordered. The server flags them in the quote; block placement here
  // (and show which product needs the fix) until an admin approves the
  // mapping/classification.
  const gstPending = quote?.needsReview || [];

  async function handlePlaceOrder() {
    setError("");

    if (gstPending.length > 0) {
      setError(
        `GST verification pending: ${gstPending
          .map((item) => item.name)
          .join(", ")}. Admin approval के बाद ही order हो सकता है।`
      );
      return;
    }

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

    if (!city.trim()) {
      alert("Please enter your city.");
      return;
    }

    if (!stateName.trim()) {
      alert("Please enter your state.");
      return;
    }

    if (!/^\d{6}$/.test(pincode.trim())) {
      alert("Please enter a valid 6-digit PIN code.");
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
          city: city.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
          email: email.trim(),
          phone: phone.replace(/\D/g, ""),
          paymentMethod,
          // Echo the exact total the buyer saw — the backend re-validates
          // it and rejects with PRICE_MISMATCH on any difference.
          ...(quote ? { clientGrandTotal: quote.grandTotal } : {}),
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
      <div className="jb-page" style={styles.page}>
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
                <span>Payment Status</span>
                <strong>
                  {placedOrder.paymentStatus || "Pending"}
                  {placedOrder.paymentMethod === "UPI" ||
                  placedOrder.paymentMethod === "BankTransfer"
                    ? " — awaiting confirmation"
                    : ""}
                </strong>
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
    <div className="jb-page" style={styles.page}>
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
            {cart.length} item{cart.length === 1 ? "" : "s"}
            {quote
              ? ` · Total ₹${displayTotal.toLocaleString("en-IN")}`
              : ""}
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
                  {(itemFinalPrice(item) * (Number(item.quantity) || 1)).toLocaleString(
                    "en-IN"
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* SAVED ADDRESS PICKER */}
          {savedAddresses.length > 0 && (
            <div style={styles.field}>
              <label style={styles.label}>Choose a Saved Address</label>
              <select
                value={selectedAddressId}
                onChange={(e) => {
                  const selected = savedAddresses.find((item) => String(item.id) === e.target.value);
                  setSelectedAddressId(e.target.value);
                  if (selected) {
                    setAddress(selected.address || "");
                    setCity(selected.city || "");
                    setStateName(selected.state || "");
                    setPincode(selected.pincode || "");
                    if (selected.mobile) setPhone(selected.mobile);
                  }
                }}
                style={styles.input}
              >
                <option value="">Enter a different address</option>
                {savedAddresses.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.label}{item.isDefault ? " (Default)" : ""} — {item.city}, {item.pincode}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ADDRESS */}
          <div style={styles.field}>
            <label style={styles.label}>Delivery Address</label>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House no, street, area, landmark"
              style={styles.textarea}
            />
          </div>

          {/* CITY / STATE / PIN */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "10px",
            }}
          >
            <div style={styles.field}>
              <label style={styles.label}>City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>State</label>
              <input
                type="text"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                placeholder="State"
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>PIN Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={pincode}
                onChange={(e) =>
                  setPincode(e.target.value.replace(/\D/g, ""))
                }
                placeholder="6-digit PIN"
                maxLength="6"
                style={styles.input}
              />
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              borderRadius: "10px",
              padding: "12px 14px",
              marginBottom: "14px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: "bold", color: "#334155" }}>
              🚚 Delivery serviceability
            </div>
            {courierChecking ? (
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "5px" }}>
                Checking courier service for PIN {pincode}…
              </div>
            ) : courierCheck ? (
              courierCheck.serviceable ? (
                <div style={{ fontSize: "12px", color: "#166534", marginTop: "5px" }}>
                  Delivery available. Recommended:{" "}
                  <strong>
                    {courierCheck.recommended?.courierName ||
                      courierCheck.recommended?.partnerName}
                  </strong>{" "}
                  {courierCheck.recommended?.estimatedDeliveryDays
                    ? `· about ${courierCheck.recommended.estimatedDeliveryDays} day(s)`
                    : ""}
                  {courierCheck.recommended?.estimatedDeliveryDate
                    ? ` · ETA ${courierCheck.recommended.estimatedDeliveryDate}`
                    : ""}
                  .
                  <div style={{ color: "#64748b", marginTop: "4px" }}>
                    Courier estimate ₹{Number(courierCheck.recommended?.rate || 0).toFixed(2)}. The
                    delivery charge already included in your JustBrand total is ₹
                    {Number(quote?.deliveryCharge || 0).toFixed(2)}; the courier estimate is not added
                    again.
                  </div>
                  {courierCheck.quotes?.length > 1 ? (
                    <div style={{ color: "#64748b", marginTop: "4px" }}>
                      {courierCheck.quotes.length} serviceable option(s) — the admin can choose the
                      best courier.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#b45309", marginTop: "5px" }}>
                  No enabled courier is currently serviceable for this PIN/package. Your order can
                  still be placed; the JustBrand team will arrange delivery. No fake courier option
                  is shown.
                </div>
              )
            ) : (
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "5px" }}>
                Enter a 6-digit PIN to check courier serviceability.
              </div>
            )}
          </div>

          {/* CONTACT EMAIL (OPTIONAL) */}
          <div style={styles.field}>
            <label style={styles.label}>Email (optional — for order updates)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={styles.input}
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

          {quote && (
            <div style={styles.summaryBox} className="jb-quote-breakdown">
              <div style={styles.summaryRow}>
                <span>
                  Product price (
                  {quote.items.reduce((sum, item) => sum + item.quantity, 0)} items)
                </span>
                <strong>₹{quote.itemsTotal.toLocaleString("en-IN")}</strong>
              </div>

              {quote.discountTotal > 0 && (
                <div style={styles.summaryRow}>
                  <span>Discount on MRP</span>
                  <strong style={{ color: "#137a13" }}>
                    −₹{quote.discountTotal.toLocaleString("en-IN")}
                  </strong>
                </div>
              )}

              {/* The delivery charge is part of the authoritative
                  JustBrand quote. Showing it does not add it twice —
                  the grand total below already contains it. */}

              {quote && Number(quote.deliveryCharge) > 0 ? (
                <div style={styles.summaryRow}>
                  <span>Delivery charge (included)</span>
                  <strong>₹{Number(quote.deliveryCharge).toLocaleString("en-IN")}</strong>
                </div>
              ) : null}

              <div
                style={{
                  ...styles.summaryRow,
                  borderTop: "1px solid #eee",
                  marginTop: "6px",
                  paddingTop: "8px",
                }}
              >
                <span>
                  <strong>Total</strong>
                </span>
                <strong>₹{quote.grandTotal.toLocaleString("en-IN")}</strong>
              </div>
            </div>
          )}

          {gstPending.length > 0 && (
            <div
              style={{
                ...styles.errorBox,
                background: "#fff8e1",
                border: "1px solid #f0d48a",
                color: "#7a5200",
              }}
            >
              ⚠️ <b>GST verification pending</b> —{" "}
              {gstPending.map((item) => item.name).join(", ")}. यह product
              तब तक order नहीं हो सकता जब तक Admin इसे approve न करे।
            </div>
          )}

          {error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          <button
            type="button"
            disabled={placing || gstPending.length > 0}
            onClick={handlePlaceOrder}
            style={{
              ...styles.placeOrderButton,
              opacity: placing || gstPending.length > 0 ? 0.7 : 1,
              cursor: gstPending.length > 0 ? "not-allowed" : "pointer",
            }}
          >
            {placing
              ? "Placing Order..."
              : gstPending.length > 0
              ? "⛔ GST verification pending"
              : `✅ Place Order · ₹${displayTotal.toLocaleString("en-IN")}`}
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
    background: "transparent",
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

import React, { useEffect, useState } from "react";
import { api } from "../api";

function CustomerOrders({ token, onBack, onNeedLogin }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      onNeedLogin?.();
      return;
    }

    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadOrders() {
    setLoading(true);
    setError("");

    try {
      const data = await api("/api/customer/orders", { token });

      if (data.success) {
        setOrders(data.orders || []);
      } else {
        setError(data.message || "Failed to load orders.");
      }
    } catch (error) {
      console.error("Load orders error:", error);
      setError(error.message || "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(order) {
    if (
      !window.confirm(
        `Cancel order ${order.orderNumber}? This cannot be undone.`
      )
    ) {
      return;
    }

    setCancellingId(order.id);

    try {
      const data = await api(`/api/customer/orders/${order.id}/cancel`, {
        method: "PUT",
        token,
      });

      if (data.success) {
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: "Cancelled" } : o))
        );
      } else {
        alert(data.message || "Failed to cancel order.");
      }
    } catch (error) {
      console.error("Cancel order error:", error);
      alert(error.message || "Could not cancel the order. Please try again.");
    } finally {
      setCancellingId(null);
    }
  }

  function statusStyle(status) {
    switch (status) {
      case "Delivered":
        return { background: "#e6f7e6", color: "#1a7a1a" };
      case "Cancelled":
      case "Returned":
      case "Refunded":
        return { background: "#fff0f0", color: "#c00" };
      case "Shipped":
        return { background: "#e8f0ff", color: "#1a5dc8" };
      default:
        return { background: "#fff7e6", color: "#a06a00" };
    }
  }

  function canCancel(status) {
    return ["Pending", "Processing"].includes(status);
  }

  function orderItems(order) {
    if (Array.isArray(order.items)) {
      return order.items;
    }

    try {
      const parsed = JSON.parse(order.itemsJson || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return (
    <div className="jb-page" style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>My Orders</div>
        </div>

        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.inner}>
          {loading ? (
            <div style={styles.emptyCard}>Loading your orders...</div>
          ) : error ? (
            <div style={styles.emptyCard}>⚠️ {error}</div>
          ) : orders.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={styles.emptyIcon}>📦</div>
              <div style={styles.emptyTitle}>No orders yet</div>
              <div style={styles.emptyText}>
                Your orders will appear here after you shop.
              </div>
            </div>
          ) : (
            orders.map((order) => (
              <div key={order.id} style={styles.orderCard}>
                <div style={styles.orderTop}>
                  <div>
                    <div style={styles.orderNumber}>
                      #{order.orderNumber}
                    </div>
                    <div style={styles.orderDate}>
                      {String(order.createdAt || "").slice(0, 19).replace("T", " ")}
                    </div>
                  </div>

                  <span style={{ ...styles.statusBadge, ...statusStyle(order.status) }}>
                    {order.status}
                  </span>
                </div>

                <div style={styles.itemsBox}>
                  {orderItems(order).map((item, index) => (
                    <div key={index} style={styles.itemRow}>
                      <span style={styles.itemName}>
                        {item.productName} × {item.quantity}
                      </span>
                      <span style={styles.itemPrice}>₹{item.price}</span>
                    </div>
                  ))}
                </div>

                <div style={styles.orderBottom}>
                  <div>
                    <div style={styles.metaText}>
                      💳 {order.paymentMethod} · {order.paymentStatus}
                    </div>
                    <div style={styles.metaText}>
                      📍 {order.address}
                    </div>
                  </div>

                  <div style={styles.totalAndCancel}>
                    <div style={styles.total}>₹{order.totalAmount}</div>

                    {canCancel(order.status) && (
                      <button
                        type="button"
                        disabled={cancellingId === order.id}
                        onClick={() => handleCancel(order)}
                        style={styles.cancelButton}
                      >
                        {cancellingId === order.id
                          ? "Cancelling..."
                          : "Cancel Order"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
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
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  inner: {
    maxWidth: "760px",
    margin: "0 auto",
  },

  emptyCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "40px 30px",
    textAlign: "center",
    boxShadow: "0 5px 25px rgba(0,0,0,0.09)",
    color: "#777",
    fontSize: "15px",
  },

  emptyIcon: {
    fontSize: "40px",
    marginBottom: "10px",
  },

  emptyTitle: {
    fontWeight: "bold",
    fontSize: "18px",
    color: "#333",
    marginBottom: "5px",
  },

  emptyText: {
    fontSize: "13px",
  },

  orderCard: {
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    marginBottom: "18px",
    boxShadow: "0 3px 15px rgba(0,0,0,0.07)",
  },

  orderTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
    marginBottom: "12px",
  },

  orderNumber: {
    fontWeight: "bold",
    fontSize: "15px",
    color: "#333",
  },

  orderDate: {
    fontSize: "12px",
    color: "#999",
    marginTop: "3px",
  },

  statusBadge: {
    padding: "5px 12px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },

  itemsBox: {
    background: "#fafafa",
    borderRadius: "10px",
    padding: "12px",
    marginBottom: "12px",
  },

  itemRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    fontSize: "13px",
    padding: "4px 0",
  },

  itemName: {
    color: "#444",
  },

  itemPrice: {
    fontWeight: "bold",
    color: "#ff6b00",
    whiteSpace: "nowrap",
  },

  orderBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "12px",
    flexWrap: "wrap",
  },

  metaText: {
    fontSize: "12px",
    color: "#777",
    marginTop: "3px",
    maxWidth: "380px",
  },

  totalAndCancel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
  },

  total: {
    fontWeight: "bold",
    fontSize: "17px",
    color: "#ff1493",
  },

  cancelButton: {
    border: "1px solid #ffb3b3",
    background: "#fff5f5",
    color: "#c00",
    padding: "8px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "bold",
  },
};

export default CustomerOrders;

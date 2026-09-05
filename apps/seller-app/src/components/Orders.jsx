import React, { useEffect, useState } from "react";

function Orders({ onBack }) {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedOrder, setSelectedOrder] = useState(null);

  // ==========================================
  // LOAD ORDERS
  // ==========================================

  useEffect(() => {
    loadOrders();

    const timer = setInterval(() => {
      loadOrders();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  function loadOrders() {
    try {
      const saved = localStorage.getItem(
        "justbrand_seller_orders"
      );

      if (saved) {
        const data = JSON.parse(saved);

        if (Array.isArray(data)) {
          setOrders(data);
        } else {
          setOrders([]);
        }
      } else {
        setOrders([]);
      }
    } catch (error) {
      console.error(
        "Orders loading error:",
        error
      );

      setOrders([]);
    }
  }

  // ==========================================
  // UPDATE ORDER STATUS
  // ==========================================

  function updateOrderStatus(orderId, newStatus) {
    const updatedOrders = orders.map((order) => {
      if (order.id === orderId) {
        return {
          ...order,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
      }

      return order;
    });

    setOrders(updatedOrders);

    localStorage.setItem(
      "justbrand_seller_orders",
      JSON.stringify(updatedOrders)
    );

    if (
      selectedOrder &&
      selectedOrder.id === orderId
    ) {
      setSelectedOrder({
        ...selectedOrder,
        status: newStatus,
      });
    }

    alert(
      `Order status updated to ${newStatus}`
    );
  }

  // ==========================================
  // SEARCH + FILTER
  // ==========================================

  const filteredOrders = orders.filter(
    (order) => {
      const searchText =
        search.toLowerCase().trim();

      const orderId = String(
        order.id || ""
      ).toLowerCase();

      const customerName = String(
        order.customerName ||
          order.customer?.name ||
          ""
      ).toLowerCase();

      const productName = String(
        order.productName ||
          order.product?.name ||
          ""
      ).toLowerCase();

      const status = String(
        order.status || "Pending"
      );

      const matchesSearch =
        orderId.includes(searchText) ||
        customerName.includes(searchText) ||
        productName.includes(searchText);

      const matchesStatus =
        statusFilter === "All" ||
        status.toLowerCase() ===
          statusFilter.toLowerCase();

      return (
        matchesSearch &&
        matchesStatus
      );
    }
  );

  // ==========================================
  // ORDER STATISTICS
  // ==========================================

  const totalOrders = orders.length;

  const pendingOrders =
    orders.filter(
      (order) =>
        String(
          order.status || "Pending"
        ).toLowerCase() === "pending"
    ).length;

  const processingOrders =
    orders.filter(
      (order) =>
        String(
          order.status || ""
        ).toLowerCase() ===
        "processing"
    ).length;

  const shippedOrders =
    orders.filter(
      (order) =>
        String(
          order.status || ""
        ).toLowerCase() ===
        "shipped"
    ).length;

  const deliveredOrders =
    orders.filter(
      (order) =>
        String(
          order.status || ""
        ).toLowerCase() ===
        "delivered"
    ).length;

  const cancelledOrders =
    orders.filter(
      (order) =>
        String(
          order.status || ""
        ).toLowerCase() ===
        "cancelled"
    ).length;

  // ==========================================
  // FORMAT DATE
  // ==========================================

  function formatDate(date) {
    if (!date) {
      return "-";
    }

    try {
      return new Date(
        date
      ).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "-";
    }
  }

  return (
    <div style={styles.page}>

      {/* ======================================
          HEADER
      ====================================== */}

      <header style={styles.header}>

        <div>
          <div style={styles.logo}>
            JustBrand
          </div>

          <div style={styles.panelText}>
            Seller Panel
          </div>
        </div>

        <button
          onClick={onBack}
          style={styles.backButton}
        >
          ← Dashboard
        </button>

      </header>

      {/* ======================================
          MAIN
      ====================================== */}

      <main style={styles.container}>

        {/* TITLE */}

        <div style={styles.titleBox}>

          <div>
            <h1 style={styles.title}>
              🛒 Orders
            </h1>

            <p style={styles.subtitle}>
              Manage your JustBrand seller
              orders
            </p>
          </div>

          <div style={styles.orderBadge}>
            📦 {totalOrders} Orders
          </div>

        </div>

        {/* ====================================
            STATISTICS
        ==================================== */}

        <div style={styles.statsGrid}>

          <StatCard
            icon="📦"
            title="Total Orders"
            value={totalOrders}
          />

          <StatCard
            icon="🕐"
            title="Pending"
            value={pendingOrders}
          />

          <StatCard
            icon="⚙️"
            title="Processing"
            value={processingOrders}
          />

          <StatCard
            icon="🚚"
            title="Shipped"
            value={shippedOrders}
          />

          <StatCard
            icon="✅"
            title="Delivered"
            value={deliveredOrders}
          />

          <StatCard
            icon="❌"
            title="Cancelled"
            value={cancelledOrders}
          />

        </div>

        {/* ====================================
            SEARCH + FILTER
        ==================================== */}

        <div style={styles.filterBox}>

          <input
            type="text"
            placeholder="🔎 Search Order ID, Customer or Product..."
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            style={styles.searchInput}
          />

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
            style={styles.statusSelect}
          >
            <option value="All">
              All Orders
            </option>

            <option value="Pending">
              Pending
            </option>

            <option value="Processing">
              Processing
            </option>

            <option value="Shipped">
              Shipped
            </option>

            <option value="Delivered">
              Delivered
            </option>

            <option value="Cancelled">
              Cancelled
            </option>
          </select>

        </div>

        {/* ====================================
            ORDERS
        ==================================== */}

        {filteredOrders.length === 0 ? (

          <div style={styles.emptyBox}>

            <div style={styles.emptyIcon}>
              🛒
            </div>

            <h2>
              No Orders Found
            </h2>

            <p>
              {orders.length === 0
                ? "You don't have any orders yet."
                : "Try changing your search or filter."}
            </p>

          </div>

        ) : (

          <div style={styles.ordersList}>

            {filteredOrders.map(
              (order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onView={() =>
                    setSelectedOrder(
                      order
                    )
                  }
                />
              )
            )}

          </div>

        )}

      </main>

      {/* ======================================
          ORDER DETAILS MODAL
      ====================================== */}

      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() =>
            setSelectedOrder(null)
          }
          onStatusChange={
            updateOrderStatus
          }
          formatDate={formatDate}
        />
      )}

    </div>
  );
}


/* ==========================================
   STAT CARD
========================================== */

function StatCard({
  icon,
  title,
  value,
}) {
  return (
    <div style={styles.statCard}>

      <div style={styles.statIcon}>
        {icon}
      </div>

      <div style={styles.statTitle}>
        {title}
      </div>

      <div style={styles.statValue}>
        {value}
      </div>

    </div>
  );
}


/* ==========================================
   ORDER CARD
========================================== */

function OrderCard({
  order,
  onView,
}) {
  const status =
    order.status || "Pending";

  const statusStyle =
    getStatusStyle(status);

  const customerName =
    order.customerName ||
    order.customer?.name ||
    "Customer";

  const productName =
    order.productName ||
    order.product?.name ||
    "Product";

  const productImage =
    order.productImage ||
    order.image ||
    order.product?.image ||
    "/images/product1.png";

  const quantity =
    order.quantity || 1;

  const price =
    order.total ||
    order.totalAmount ||
    order.price ||
    "₹0";

  return (
    <div style={styles.orderCard}>

      {/* IMAGE */}

      <div style={styles.orderImageBox}>

        <img
          src={productImage}
          alt={productName}
          onError={(e) => {
            e.currentTarget.src =
              "/images/product1.png";
          }}
          style={styles.orderImage}
        />

      </div>

      {/* CONTENT */}

      <div style={styles.orderContent}>

        <div style={styles.orderTop}>

          <div>

            <div style={styles.orderId}>
              Order #{order.id}
            </div>

            <div style={styles.productName}>
              {productName}
            </div>

          </div>

          <span
            style={{
              ...styles.statusBadge,
              ...statusStyle,
            }}
          >
            {status}
          </span>

        </div>

        <div style={styles.orderInfoGrid}>

          <div>
            <span style={styles.infoLabel}>
              Customer
            </span>

            <strong>
              👤 {customerName}
            </strong>
          </div>

          <div>
            <span style={styles.infoLabel}>
              Quantity
            </span>

            <strong>
              {quantity}
            </strong>
          </div>

          <div>
            <span style={styles.infoLabel}>
              Amount
            </span>

            <strong style={styles.amount}>
              {price}
            </strong>
          </div>

        </div>

        <div style={styles.orderBottom}>

          <span style={styles.orderDate}>
            📅{" "}
            {order.createdAt
              ? new Date(
                  order.createdAt
                ).toLocaleDateString(
                  "en-IN"
                )
              : "-"}
          </span>

          <button
            onClick={onView}
            style={styles.viewButton}
          >
            View Details →
          </button>

        </div>

      </div>

    </div>
  );
}


/* ==========================================
   ORDER DETAILS
========================================== */

function OrderDetails({
  order,
  onClose,
  onStatusChange,
  formatDate,
}) {
  const customerName =
    order.customerName ||
    order.customer?.name ||
    "Customer";

  const mobile =
    order.customerMobile ||
    order.customer?.mobile ||
    order.mobile ||
    "Not Available";

  const address =
    order.address ||
    order.customer?.address ||
    "Address not available";

  const productName =
    order.productName ||
    order.product?.name ||
    "Product";

  const image =
    order.productImage ||
    order.image ||
    order.product?.image ||
    "/images/product1.png";

  const quantity =
    order.quantity || 1;

  const amount =
    order.total ||
    order.totalAmount ||
    order.price ||
    "₹0";

  return (
    <div style={styles.modalOverlay}>

      <div style={styles.modal}>

        {/* HEADER */}

        <div style={styles.modalHeader}>

          <div>
            <h2 style={{ margin: 0 }}>
              📦 Order Details
            </h2>

            <div style={styles.modalOrderId}>
              Order #{order.id}
            </div>
          </div>

          <button
            onClick={onClose}
            style={styles.closeButton}
          >
            ✕
          </button>

        </div>

        {/* PRODUCT */}

        <div style={styles.detailProduct}>

          <div style={styles.detailImageBox}>

            <img
              src={image}
              alt={productName}
              onError={(e) => {
                e.currentTarget.src =
                  "/images/product1.png";
              }}
              style={styles.detailImage}
            />

          </div>

          <div>

            <div style={styles.detailLabel}>
              Product
            </div>

            <h3 style={{ margin: "4px 0" }}>
              {productName}
            </h3>

            <div>
              Quantity:{" "}
              <strong>
                {quantity}
              </strong>
            </div>

            <div style={styles.detailAmount}>
              {amount}
            </div>

          </div>

        </div>

        {/* CUSTOMER */}

        <div style={styles.detailSection}>

          <h3>
            👤 Customer Information
          </h3>

          <p>
            <strong>Name:</strong>{" "}
            {customerName}
          </p>

          <p>
            <strong>Mobile:</strong>{" "}
            {mobile}
          </p>

          <p>
            <strong>Address:</strong>{" "}
            {address}
          </p>

        </div>

        {/* PAYMENT */}

        <div style={styles.detailSection}>

          <h3>
            💳 Payment
          </h3>

          <p>
            <strong>Payment Method:</strong>{" "}
            {order.paymentMethod ||
              "Online / COD"}
          </p>

          <p>
            <strong>Payment Status:</strong>{" "}
            {order.paymentStatus ||
              "Pending"}
          </p>

          <p>
            <strong>Order Date:</strong>{" "}
            {formatDate(
              order.createdAt
            )}
          </p>

        </div>

        {/* STATUS */}

        <div style={styles.statusSection}>

          <label style={styles.statusLabel}>
            Update Order Status
          </label>

          <select
            value={
              order.status || "Pending"
            }
            onChange={(e) =>
              onStatusChange(
                order.id,
                e.target.value
              )
            }
            style={styles.modalSelect}
          >
            <option value="Pending">
              Pending
            </option>

            <option value="Processing">
              Processing
            </option>

            <option value="Shipped">
              Shipped
            </option>

            <option value="Delivered">
              Delivered
            </option>

            <option value="Cancelled">
              Cancelled
            </option>
          </select>

        </div>

        {/* CLOSE */}

        <button
          onClick={onClose}
          style={styles.doneButton}
        >
          Done
        </button>

      </div>

    </div>
  );
}


/* ==========================================
   STATUS STYLE
========================================== */

function getStatusStyle(status) {
  const value =
    String(status).toLowerCase();

  if (value === "delivered") {
    return {
      background: "#d4edda",
      color: "#155724",
    };
  }

  if (value === "shipped") {
    return {
      background: "#d1ecf1",
      color: "#0c5460",
    };
  }

  if (value === "processing") {
    return {
      background: "#cce5ff",
      color: "#004085",
    };
  }

  if (value === "cancelled") {
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


/* ==========================================
   STYLES
========================================== */

const styles = {

  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    boxSizing: "border-box",
  },

  logo: {
    fontSize: "24px",
    fontWeight: "bold",
  },

  panelText: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  backButton: {
    border: "none",
    background: "#fff",
    color: "#ff1493",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  container: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "25px",
    boxSizing: "border-box",
  },

  titleBox: {
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
  },

  title: {
    margin: 0,
    fontSize: "26px",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  orderBadge: {
    background: "#fff0f5",
    color: "#ff1493",
    padding: "9px 14px",
    borderRadius: "20px",
    fontWeight: "bold",
    fontSize: "13px",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(160px,1fr))",
    gap: "15px",
    marginTop: "20px",
  },

  statCard: {
    background: "#fff",
    borderRadius: "12px",
    padding: "17px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
  },

  statIcon: {
    fontSize: "25px",
  },

  statTitle: {
    color: "#777",
    fontSize: "12px",
    marginTop: "6px",
  },

  statValue: {
    fontSize: "25px",
    fontWeight: "bold",
    marginTop: "3px",
  },

  filterBox: {
    background: "#fff",
    padding: "15px",
    borderRadius: "12px",
    marginTop: "20px",
    display: "grid",
    gridTemplateColumns:
      "1fr 220px",
    gap: "12px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  searchInput: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    boxSizing: "border-box",
    outline: "none",
  },

  statusSelect: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    background: "#fff",
  },

  ordersList: {
    marginTop: "20px",
    display: "grid",
    gap: "15px",
  },

  orderCard: {
    background: "#fff",
    borderRadius: "14px",
    padding: "15px",
    display: "flex",
    gap: "15px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
  },

  orderImageBox: {
    width: "120px",
    height: "120px",
    background: "#f7f7f7",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },

  orderImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },

  orderContent: {
    flex: 1,
    minWidth: 0,
  },

  orderTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },

  orderId: {
    color: "#888",
    fontSize: "12px",
  },

  productName: {
    fontSize: "18px",
    fontWeight: "bold",
    marginTop: "4px",
  },

  statusBadge: {
    padding: "6px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },

  orderInfoGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3,1fr)",
    gap: "12px",
    marginTop: "15px",
  },

  infoLabel: {
    display: "block",
    color: "#999",
    fontSize: "11px",
    marginBottom: "3px",
  },

  amount: {
    color: "#ff6b00",
  },

  orderBottom: {
    marginTop: "15px",
    paddingTop: "12px",
    borderTop: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
  },

  orderDate: {
    color: "#888",
    fontSize: "12px",
  },

  viewButton: {
    border: "none",
    background: "#fff0f5",
    color: "#ff1493",
    padding: "8px 12px",
    borderRadius: "7px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  emptyBox: {
    background: "#fff",
    borderRadius: "14px",
    marginTop: "20px",
    padding: "60px 20px",
    textAlign: "center",
  },

  emptyIcon: {
    fontSize: "60px",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background:
      "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 9999,
    boxSizing: "border-box",
  },

  modal: {
    width: "100%",
    maxWidth: "650px",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#fff",
    borderRadius: "15px",
    padding: "20px",
    boxSizing: "border-box",
  },

  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "1px solid #eee",
    paddingBottom: "15px",
  },

  modalOrderId: {
    color: "#888",
    fontSize: "12px",
    marginTop: "4px",
  },

  closeButton: {
    width: "35px",
    height: "35px",
    border: "none",
    borderRadius: "50%",
    background: "#f5f5f5",
    cursor: "pointer",
    fontSize: "16px",
  },

  detailProduct: {
    display: "flex",
    gap: "15px",
    marginTop: "20px",
    padding: "15px",
    background: "#fafafa",
    borderRadius: "10px",
  },

  detailImageBox: {
    width: "110px",
    height: "110px",
    background: "#fff",
    borderRadius: "8px",
    overflow: "hidden",
    flexShrink: 0,
  },

  detailImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },

  detailLabel: {
    color: "#999",
    fontSize: "11px",
  },

  detailAmount: {
    color: "#ff6b00",
    fontSize: "20px",
    fontWeight: "bold",
    marginTop: "6px",
  },

  detailSection: {
    marginTop: "18px",
    padding: "15px",
    background: "#fafafa",
    borderRadius: "10px",
  },

  statusSection: {
    marginTop: "18px",
  },

  statusLabel: {
    display: "block",
    fontWeight: "bold",
    marginBottom: "7px",
  },

  modalSelect: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    background: "#fff",
    fontSize: "14px",
  },

  doneButton: {
    width: "100%",
    marginTop: "20px",
    padding: "12px",
    border: "none",
    borderRadius: "8px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
  },
};

export default Orders;
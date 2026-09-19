import React, { useEffect, useState } from "react";
import "../index.css";

const API_URL = "https://justbrand-in-144629.hostingersite.com";

function Orders({ onBack }) {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("All");

  const [selectedOrder, setSelectedOrder] =
    useState(null);

  // ==========================================
  // LOAD ORDERS (BACKEND — OWN PRODUCTS ONLY)
  // ==========================================

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    const token =
      localStorage.getItem("justbrand_seller_token") || "";

    if (!token) {
      setOrders([]);
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/sellers/orders`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Backend orders loading failed.");
      }

      const data = await response.json();

      const backendOrders = Array.isArray(data.orders)
        ? data.orders
        : [];

      // Map backend orders to the shape this page renders.
      const mapped = backendOrders.map((order) => {
        const firstItem =
          Array.isArray(order.items) && order.items.length > 0
            ? order.items[0]
            : null;

        return {
          ...order,
          id: order.id,

          buyerName:
            order.customerName || "Customer",

          phone:
            order.phone || "",

          address:
            order.address || "",

          total: order.totalAmount || 0,

          productName:
            firstItem?.productName || "Product",

          quantity: firstItem?.quantity || 1,

          items: order.items || [],
        };
      });

      setOrders(mapped);
    } catch (error) {
      console.error(
        "Orders loading error:",
        error
      );

      setOrders([]);
    }
  }

  // ==========================================
  // UPDATE ORDER STATUS (BACKEND)
  // ==========================================

  async function updateOrderStatus(
    orderId,
    newStatus
  ) {
    const token =
      localStorage.getItem("justbrand_seller_token") || "";

    if (!token) {
      alert("Your session has expired. Please login again.");
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/sellers/orders/${orderId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        alert(
          data?.message ||
            "Order status update failed."
        );
        return;
      }

      // Reload authoritative state from the backend.
      await loadOrders();

      setSelectedOrder(null);

      alert(
        `Order status updated to ${newStatus}.`
      );
    } catch (error) {
      console.error(
        "Order status update error:",
        error
      );

      alert(
        "Backend से connection नहीं हो रहा. Status update failed."
      );
    }
  }

  // ==========================================
  // SEARCH + FILTER
  // ==========================================

  const searchText =
    search.toLowerCase().trim();

  const filteredOrders =
    orders.filter((order) => {
      const orderId = String(
        order.id || ""
      ).toLowerCase();

      const buyerName = String(
        order.buyerName ||
          order.customerName ||
          ""
      ).toLowerCase();

      const productName = String(
        order.productName ||
          order.product?.name ||
          ""
      ).toLowerCase();

      const phone = String(
        order.phone ||
          order.mobile ||
          order.buyerPhone ||
          ""
      ).toLowerCase();

      const currentStatus =
        String(
          order.status || "Pending"
        ).toLowerCase();

      const matchesSearch =
        orderId.includes(searchText) ||
        buyerName.includes(searchText) ||
        productName.includes(searchText) ||
        phone.includes(searchText);

      const matchesStatus =
        statusFilter === "All" ||
        currentStatus ===
          statusFilter.toLowerCase();

      return (
        matchesSearch &&
        matchesStatus
      );
    });

  // ==========================================
  // SUMMARY
  // ==========================================

  const totalOrders =
    orders.length;

  const pendingOrders =
    orders.filter(
      (order) =>
        String(
          order.status || "Pending"
        ).toLowerCase() ===
        "pending"
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
  // TOTAL SALES
  // ==========================================

  const totalSales =
    orders.reduce(
      (total, order) => {
        const amount =
          Number(
            String(
              order.total ||
                order.amount ||
                order.price ||
                0
            ).replace(
              /[^0-9.]/g,
              ""
            )
          );

        return total + amount;
      },
      0
    );

  // ==========================================
  // UI
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
          justifyContent:
            "space-between",
          gap: "15px",
          flexWrap: "wrap",
        }}
        className="jb-section-header"
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
          maxWidth: "1250px",
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
              🛒 Orders
            </h1>

            <p
              style={{
                margin: "6px 0 0",
                color: "#777",
              }}
            >
              Manage your customer orders
            </p>
          </div>

          <div
            style={{
              background: "#eef7ff",
              color: "#1769aa",
              padding: "9px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: "bold",
            }}
          >
            📦 {totalOrders} Total Orders
          </div>
        </div>

        {/* ===================================
            SUMMARY CARDS
        =================================== */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(170px,1fr))",
            gap: "15px",
            marginTop: "20px",
          }}
        >
          <SummaryCard
            icon="🛒"
            title="Total Orders"
            value={totalOrders}
          />

          <SummaryCard
            icon="🕐"
            title="Pending"
            value={pendingOrders}
          />

          <SummaryCard
            icon="⚙️"
            title="Processing"
            value={processingOrders}
          />

          <SummaryCard
            icon="🚚"
            title="Shipped"
            value={shippedOrders}
          />

          <SummaryCard
            icon="✅"
            title="Delivered"
            value={deliveredOrders}
          />

          <SummaryCard
            icon="❌"
            title="Cancelled"
            value={cancelledOrders}
          />
        </div>

        {/* ===================================
            SALES
        =================================== */}

        <div
          style={{
            background: "white",
            borderRadius: "12px",
            padding: "18px",
            marginTop: "20px",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              color: "#777",
              fontSize: "13px",
            }}
          >
            Total Order Value
          </div>

          <div
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: "#ff6b00",
              marginTop: "5px",
            }}
          >
            ₹{totalSales.toLocaleString(
              "en-IN"
            )}
          </div>
        </div>

        {/* ===================================
            SEARCH + FILTER
        =================================== */}

        <div
          style={{
            background: "white",
            borderRadius: "12px",
            padding: "15px",
            marginTop: "20px",
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="🔎 Search Order ID, buyer, product or phone..."
            style={{
              flex: 1,
              minWidth: "250px",
              padding: "12px",
              border:
                "1px solid #ccc",
              borderRadius: "8px",
              fontSize: "14px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
            style={{
              padding: "12px",
              border:
                "1px solid #ccc",
              borderRadius: "8px",
              fontSize: "14px",
              background: "white",
            }}
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

        {/* ===================================
            ORDERS LIST
        =================================== */}

        <div
          style={{
            marginTop: "20px",
          }}
        >
          {filteredOrders.length ===
          0 ? (
            <EmptyOrders
              hasOrders={
                orders.length > 0
              }
            />
          ) : (
            <div
              style={{
                display: "grid",
                gap: "15px",
              }}
            >
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
        </div>
      </main>

      {/* =====================================
          ORDER DETAILS MODAL
      ===================================== */}

      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() =>
            setSelectedOrder(null)
          }
          onUpdateStatus={
            updateOrderStatus
          }
        />
      )}
    </div>
  );
}

/* ==========================================
   SUMMARY CARD
========================================== */

function SummaryCard({
  icon,
  title,
  value,
}) {
  return (
    <div
      style={{
        background: "white",
        padding: "17px",
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
          fontSize: "23px",
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

  const productName =
    order.productName ||
    order.product?.name ||
    "Product";

  const buyerName =
    order.buyerName ||
    order.customerName ||
    "Customer";

  const amount =
    order.total ||
    order.amount ||
    order.price ||
    0;

  const date =
    order.createdAt
      ? new Date(
          order.createdAt
        ).toLocaleString(
          "en-IN"
        )
      : "Date not available";

  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        padding: "18px",
        boxShadow:
          "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
          gap: "15px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "12px",
              color: "#777",
            }}
          >
            ORDER ID
          </div>

          <div
            style={{
              fontWeight: "bold",
              marginTop: "3px",
            }}
          >
            #{order.id}
          </div>
        </div>

        <span
          style={{
            ...statusStyle,
            padding: "6px 12px",
            borderRadius: "20px",
            fontSize: "12px",
            fontWeight: "bold",
          }}
        >
          {status}
        </span>
      </div>

      {order.deliveryStatus ? (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            background: "#fff7ed",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#c2410c",
            fontWeight: 600,
          }}
        >
          🚚 Delivery: {order.deliveryStatus}
          {order.deliveryPartnerName
            ? ` • Partner: ${order.deliveryPartnerName}`
            : ""}
          {order.deliveryStatus === "Delivery Failed" &&
          order.deliveryFailureReason
            ? ` • ${order.deliveryFailureReason}`
            : ""}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(180px,1fr))",
          gap: "15px",
          marginTop: "18px",
        }}
      >
        <div>
          <div
            style={{
              color: "#888",
              fontSize: "12px",
            }}
          >
            PRODUCT
          </div>

          <strong>
            {productName}
          </strong>
        </div>

        <div>
          <div
            style={{
              color: "#888",
              fontSize: "12px",
            }}
          >
            BUYER
          </div>

          <strong>
            {buyerName}
          </strong>
        </div>

        <div>
          <div
            style={{
              color: "#888",
              fontSize: "12px",
            }}
          >
            AMOUNT
          </div>

          <strong
            style={{
              color: "#ff6b00",
            }}
          >
            ₹
            {String(amount).replace(
              /₹/g,
              ""
            )}
          </strong>
        </div>

        <div>
          <div
            style={{
              color: "#888",
              fontSize: "12px",
            }}
          >
            DATE
          </div>

          <strong
            style={{
              fontSize: "13px",
            }}
          >
            {date}
          </strong>
        </div>
      </div>

      <div
        style={{
          marginTop: "16px",
          display: "flex",
          justifyContent:
            "flex-end",
        }}
      >
        <button
          onClick={onView}
          style={{
            background: "#ff6b00",
            color: "white",
            border: "none",
            padding: "10px 18px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          👁️ View Order
        </button>
      </div>
    </div>
  );
}

/* ==========================================
   EMPTY ORDERS
========================================== */

function EmptyOrders({
  hasOrders,
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        padding: "55px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "60px",
        }}
      >
        🛒
      </div>

      <h2>
        {hasOrders
          ? "No Orders Found"
          : "No Orders Yet"}
      </h2>

      <p
        style={{
          color: "#777",
        }}
      >
        {hasOrders
          ? "Try changing your search or filter."
          : "Customer orders will appear here when products are purchased."}
      </p>
    </div>
  );
}

/* ==========================================
   ORDER DETAILS
========================================== */

function OrderDetails({
  order,
  onClose,
  onUpdateStatus,
}) {
  const buyerName =
    order.buyerName ||
    order.customerName ||
    "Customer";

  const phone =
    order.phone ||
    order.mobile ||
    order.buyerPhone ||
    "Not available";

  const productName =
    order.productName ||
    order.product?.name ||
    "Product";

  const amount =
    order.total ||
    order.amount ||
    order.price ||
    0;

  const quantity =
    order.quantity || 1;

  const address =
    order.address ||
    order.shippingAddress ||
    "Address not available";

  const status =
    order.status || "Pending";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "white",
          width: "100%",
          maxWidth: "650px",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: "14px",
          boxShadow:
            "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        {/* MODAL HEADER */}

        <div
          style={{
            background:
              "linear-gradient(135deg,#ff6b00,#ff1493)",
            color: "white",
            padding: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent:
              "space-between",
            gap: "10px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                opacity: 0.9,
              }}
            >
              ORDER DETAILS
            </div>

            <div
              style={{
                fontSize: "20px",
                fontWeight: "bold",
              }}
            >
              #{order.id}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background:
                "rgba(255,255,255,0.2)",
              color: "white",
              border: "none",
              width: "35px",
              height: "35px",
              borderRadius: "50%",
              cursor: "pointer",
              fontSize: "18px",
            }}
          >
            ✕
          </button>
        </div>

        {/* DETAILS */}

        <div
          style={{
            padding: "20px",
          }}
        >
          <DetailSection
            title="📦 Product"
          >
            <DetailRow
              label="Product"
              value={productName}
            />

            <DetailRow
              label="Quantity"
              value={quantity}
            />

            <DetailRow
              label="Amount"
              value={`₹${String(
                amount
              ).replace(
                /₹/g,
                ""
              )}`}
              highlight
            />
          </DetailSection>

          <DetailSection
            title="👤 Buyer"
          >
            <DetailRow
              label="Name"
              value={buyerName}
            />

            <DetailRow
              label="Mobile"
              value={phone}
            />

            <DetailRow
              label="Address"
              value={address}
            />          </DetailSection>

          <DetailSection
            title="🚚 Order Status"
          >
            <div
              style={{
                marginTop: "10px",
              }}
            >
              <select
                value={status}
                onChange={(e) =>
                  onUpdateStatus(
                    order.id,
                    e.target.value
                  )
                }
                style={{
                  width: "100%",
                  padding: "12px",
                  border:
                    "1px solid #ccc",
                  borderRadius: "8px",
                  fontSize: "14px",
                  background: "white",
                }}
              >
                <option value="Pending">
                  Pending
                </option>

                <option value="Processing">
                  Processing
                </option>

                <option value="Ready for Pickup">
                  Ready for Pickup
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
          </DetailSection>

          {order.deliveryStatus ? (
            <DetailSection title="🛵 Delivery">
              <DetailRow
                label="Delivery Status"
                value={order.deliveryStatus}
              />

              {order.deliveryPartnerName ? (
                <DetailRow
                  label="Delivery Partner"
                  value={order.deliveryPartnerName}
                />
              ) : null}

              {order.pickedUpAt ? (
                <DetailRow
                  label="Picked Up At"
                  value={new Date(
                    order.pickedUpAt
                  ).toLocaleString("en-IN")}
                />
              ) : null}

              {order.outForDeliveryAt ? (
                <DetailRow
                  label="Out for Delivery At"
                  value={new Date(
                    order.outForDeliveryAt
                  ).toLocaleString("en-IN")}
                />
              ) : null}

              {order.deliveryStatus === "Delivered" &&
              order.deliveredAt ? (
                <DetailRow
                  label="Delivered At"
                  value={new Date(
                    order.deliveredAt
                  ).toLocaleString("en-IN")}
                />
              ) : null}

              {order.deliveryFailureReason ? (
                <DetailRow
                  label="Last Failure"
                  value={order.deliveryFailureReason}
                />
              ) : null}

              {order.returnedToSellerAt ? (
                <DetailRow
                  label="Returned to Seller At"
                  value={new Date(
                    order.returnedToSellerAt
                  ).toLocaleString("en-IN")}
                />
              ) : null}
            </DetailSection>
          ) : null}

          {/* CLOSE */}

          <button
            onClick={onClose}
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "12px",
              border:
                "1px solid #ccc",
              background: "white",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   DETAIL SECTION
========================================== */

function DetailSection({
  title,
  children,
}) {
  return (
    <div
      style={{
        marginBottom: "22px",
        paddingBottom: "18px",
        borderBottom:
          "1px solid #eee",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "17px",
        }}
      >
        {title}
      </h3>

      {children}
    </div>
  );
}

/* ==========================================
   DETAIL ROW
========================================== */

function DetailRow({
  label,
  value,
  highlight = false,
}) {
  return (
    <div
      className="jb-detail-row"
      style={{
        display: "flex",
        justifyContent:
          "space-between",
        gap: "15px",
        padding: "9px 0",
        borderBottom:
          "1px solid #f2f2f2",
      }}
    >
      <span
        style={{
          color: "#777",
          fontSize: "13px",
        }}
      >
        {label}
      </span>

      <strong
        style={{
          textAlign: "right",
          color: highlight
            ? "#ff6b00"
            : "#222",
        }}
      >
        {value}
      </strong>
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
    currentStatus ===
    "delivered"
  ) {
    return {
      background: "#d4edda",
      color: "#155724",
    };
  }

  if (
    currentStatus ===
    "cancelled"
  ) {
    return {
      background: "#f8d7da",
      color: "#721c24",
    };
  }

  if (
    currentStatus ===
    "shipped"
  ) {
    return {
      background: "#d1ecf1",
      color: "#0c5460",
    };
  }

  if (
    currentStatus ===
    "processing"
  ) {
    return {
      background: "#cce5ff",
      color: "#004085",
    };
  }

  return {
    background: "#fff3cd",
    color: "#856404",
  };
}

export default Orders;